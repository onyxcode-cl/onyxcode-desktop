/**
 * Git vía `child_process.execFile('git', ...)` — sin shell, sin dependencias extra.
 * No importa `electron`, así que puede probarse con Node puro.
 */
import { execFile } from 'node:child_process'
import { t } from '@shared/i18n'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { samePath } from '../util/paths'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { splitDiffHunks, isSingleFileDiff } from '@shared/diff-hunks'
import type {
  GitBranch,
  GitChangeKind,
  GitCommitResult,
  GitDiscardHunkResult,
  GitDiscardResult,
  GitDiscardUndoResult,
  GitDiffRequest,
  GitFileStatusDetailed,
  GitLogEntry,
  GitStatusDetailed,
  GitWorktreeDetailed
} from '@shared/ipc-code'

const MAX_BUFFER = 64 * 1024 * 1024
const MAX_UNTRACKED_DIFFS = 200
const TIMEOUT_MS = 60_000

export class GitError extends Error {
  constructor(
    message: string,
    readonly stderr = '',
    readonly exitCode: number | null = null
  ) {
    super(message)
    this.name = 'GitError'
  }
}

interface RunOptions {
  /** Códigos de salida aceptados además de 0. */
  okCodes?: number[]
  input?: string
}

interface RunResult {
  stdout: string
  stderr: string
  code: number
}

function run(cwd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(
      'git',
      args,
      {
        cwd,
        shell: false,
        maxBuffer: MAX_BUFFER,
        timeout: TIMEOUT_MS,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C',
          LANG: 'C'
        }
      },
      (err, stdout, stderr) => {
        if (!err) return resolvePromise({ stdout, stderr, code: 0 })
        const e = err as NodeJS.ErrnoException & { code?: number | string }
        if (e.code === 'ENOENT') return reject(new GitError(t('common.git.notInstalled')))
        const code = typeof e.code === 'number' ? e.code : null
        if (code !== null && opts.okCodes?.includes(code)) return resolvePromise({ stdout, stderr, code })
        const msg = (stderr.trim() || stdout.trim() || e.message).trim().split('\n').slice(-3).join('\n')
        reject(new GitError(msg || t('common.git.failed', { cmd: String(args[0]) }), stderr, code))
      }
    )
    if (opts.input !== undefined) child.stdin?.end(opts.input)
  })
}

async function git(cwd: string, args: string[], opts?: RunOptions): Promise<string> {
  return (await run(cwd, args, opts)).stdout
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

function assertDir(cwd: string): string {
  if (typeof cwd !== 'string' || !cwd || !isAbsolute(cwd)) throw new GitError(t('common.git.invalidPath', { path: String(cwd) }))
  const abs = resolve(cwd)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new GitError(t('common.git.dirMissing', { path: abs }))
  return abs
}

/** realpath tolerante: resuelve symlinks del ancestro existente más cercano (p.ej. /tmp → /private/tmp). */
function realish(p: string): string {
  let cur = p
  const tail: string[] = []
  while (!existsSync(cur)) {
    const parent = dirname(cur)
    if (parent === cur) return p
    tail.unshift(basename(cur))
    cur = parent
  }
  try {
    return join(realpathSync(cur), ...tail)
  } catch {
    return p
  }
}

/** Convierte una ruta de archivo a relativa a `root`, rechazando escapes fuera del repo. */
function toRepoPath(root: string, p: string): string {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new GitError(t('common.git.invalidFilePath'))
  const abs = realish(isAbsolute(p) ? resolve(p) : resolve(root, p))
  const rel = relative(realish(root), abs)
  if (rel === '') return '.'
  if (rel.startsWith('..') || isAbsolute(rel)) throw new GitError(t('common.git.outsideRepo', { path: p }))
  return rel.split(sep).join('/')
}

async function assertBranchName(cwd: string, name: string): Promise<void> {
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-') || /[\s\0]/.test(name)) {
    throw new GitError(t('common.git.invalidBranch', { name: String(name) }))
  }
  try {
    await git(cwd, ['check-ref-format', '--branch', name])
  } catch {
    throw new GitError(t('common.git.invalidBranch', { name }))
  }
}

// ---------------------------------------------------------------------------
// Repo
// ---------------------------------------------------------------------------

/** Raíz del repo o null si `cwd` no está dentro de un work tree. */
export async function repoRoot(cwd: string): Promise<string | null> {
  const dir = assertDir(cwd)
  try {
    const out = await git(dir, ['rev-parse', '--show-toplevel'])
    return out.trim() || null
  } catch (err) {
    if (err instanceof GitError && err.message === t('common.git.notInstalled')) throw err
    return null
  }
}

export async function isRepo(cwd: string): Promise<boolean> {
  return (await repoRoot(cwd)) !== null
}

async function requireRoot(cwd: string): Promise<string> {
  const root = await repoRoot(cwd)
  if (!root) throw new GitError(t('common.git.notRepo', { path: cwd }))
  return root
}

// ---------------------------------------------------------------------------
// Status (porcelain v2, -z)
// ---------------------------------------------------------------------------

function normXY(c: string): string {
  return c === '.' ? ' ' : c
}

function kindFrom(x: string, y: string): GitChangeKind {
  const c = x !== '.' && x !== ' ' ? x : y
  switch (c) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'typechange'
    default:
      return 'modified'
  }
}

export function parseStatusV2(out: string, root: string | null): GitStatusDetailed {
  const status: GitStatusDetailed = {
    isRepo: true,
    root,
    branch: null,
    head: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    files: []
  }
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const line = tokens[i]
    if (!line) continue
    if (line.startsWith('# ')) {
      const [, key, ...rest] = line.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.oid') status.head = value === '(initial)' ? null : value
      else if (key === 'branch.head') {
        if (value === '(detached)') status.detached = true
        else status.branch = value
      } else if (key === 'branch.upstream') status.upstream = value
      else if (key === 'branch.ab') {
        const m = /^\+(\d+) -(\d+)$/.exec(value)
        if (m) {
          status.ahead = Number(m[1])
          status.behind = Number(m[2])
        }
      }
      continue
    }
    const type = line[0]
    if (type === '1' || type === '2') {
      // 1 XY sub mH mI mW hH hI path
      // 2 XY sub mH mI mW hH hI Xscore path  \0 origPath
      const nFields = type === '1' ? 8 : 9
      const parts = line.split(' ')
      const xy = parts[1] ?? '..'
      const path = parts.slice(nFields).join(' ')
      const x = xy[0] ?? '.'
      const y = xy[1] ?? '.'
      const file: GitFileStatusDetailed = {
        path,
        index: normXY(x),
        workingDir: normXY(y),
        staged: x !== '.',
        unstaged: y !== '.',
        untracked: false,
        conflicted: false,
        kind: kindFrom(x, y)
      }
      if (type === '2') file.origPath = tokens[++i]
      status.files.push(file)
    } else if (type === 'u') {
      // u XY sub m1 m2 m3 mW h1 h2 h3 path
      const parts = line.split(' ')
      const xy = parts[1] ?? 'UU'
      status.files.push({
        path: parts.slice(10).join(' '),
        index: xy[0] ?? 'U',
        workingDir: xy[1] ?? 'U',
        staged: false,
        unstaged: true,
        untracked: false,
        conflicted: true,
        kind: 'conflicted'
      })
    } else if (type === '?' || type === '!') {
      const path = line.slice(2)
      status.files.push({
        path,
        index: type,
        workingDir: type,
        staged: false,
        unstaged: type === '?',
        untracked: type === '?',
        conflicted: false,
        kind: type === '?' ? 'untracked' : 'ignored'
      })
    }
  }
  return status
}

export async function status(cwd: string): Promise<GitStatusDetailed> {
  const root = await repoRoot(cwd)
  if (!root) {
    return {
      isRepo: false,
      root: null,
      branch: null,
      head: null,
      detached: false,
      upstream: null,
      ahead: 0,
      behind: 0,
      files: []
    }
  }
  const out = await git(root, [...NO_FSMONITOR, 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  return parseStatusV2(out, root)
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/** Repos no confiables: `core.fsmonitor` puede ejecutar un hook arbitrario del repo en status/diff. */
const NO_FSMONITOR = ['-c', 'core.fsmonitor=false']

const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--find-renames']

async function untrackedFiles(root: string, rel?: string): Promise<string[]> {
  const args = [...NO_FSMONITOR, 'ls-files', '--others', '--exclude-standard', '-z']
  if (rel) args.push('--', rel)
  const out = await git(root, args)
  return out.split('\0').filter(Boolean)
}

async function untrackedDiff(root: string, file: string): Promise<string> {
  // --no-index sale con 1 cuando hay diferencias.
  const out = await git(root, [...NO_FSMONITOR, 'diff', '--no-index', '--no-color', '--no-ext-diff', '--', '/dev/null', file], {
    okCodes: [1]
  })
  return out
}

/**
 * Pathspec para el diff staged de `rel`. Si el archivo está renombrado en el índice, incluye
 * también el path antiguo: con solo el nuevo, git no ve el origen y lo muestra como archivo añadido.
 */
async function stagedPathspec(root: string, rel: string): Promise<string[]> {
  const out = await git(root, [...NO_FSMONITOR, 'diff', '--cached', '--name-status', '-z', '--find-renames'])
  const tok = out.split('\0')
  for (let i = 0; i < tok.length;) {
    const status = tok[i]
    if (!status) break
    if (status[0] === 'R') {
      const [from, to] = [tok[i + 1], tok[i + 2]]
      if (to === rel && from) return [from, rel]
      i += 3
    } else i += 2
  }
  return [rel]
}

export async function diff(req: GitDiffRequest): Promise<string> {
  const root = await repoRoot(req.cwd)
  if (!root) return ''
  const rel = req.path ? toRepoPath(root, req.path) : undefined
  const pathArgs = rel ? ['--', rel] : []
  const parts: string[] = []

  if (req.staged !== false) {
    const stagedPaths = rel ? ['--', ...(await stagedPathspec(root, rel))] : []
    parts.push(await git(root, [...NO_FSMONITOR, 'diff', '--cached', ...DIFF_FLAGS, ...stagedPaths]))
  }
  if (req.staged !== true) {
    parts.push(await git(root, [...NO_FSMONITOR, 'diff', ...DIFF_FLAGS, ...pathArgs]))
    const files = await untrackedFiles(root, rel)
    for (const f of files.slice(0, MAX_UNTRACKED_DIFFS)) {
      try {
        parts.push(await untrackedDiff(root, f))
      } catch {
        // archivo desaparecido o ilegible: se omite
      }
    }
    if (files.length > MAX_UNTRACKED_DIFFS) {
      parts.push(`${t('common.git.untrackedOmitted', { count: files.length - MAX_UNTRACKED_DIFFS })}\n`)
    }
  }
  return parts
    .filter((p) => p.length > 0)
    .map((p) => (p.endsWith('\n') ? p : `${p}\n`))
    .join('')
}

// ---------------------------------------------------------------------------
// Ramas
// ---------------------------------------------------------------------------

export async function branches(cwd: string): Promise<GitBranch[]> {
  const root = await repoRoot(cwd)
  if (!root) return []
  const out = await git(root, [
    'for-each-ref',
    '--format=%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)',
    'refs/heads'
  ])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name = '', head = '', upstream = '', sha = ''] = line.split('\0')
      return { name, current: head === '*', upstream: upstream || null, head: sha }
    })
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const root = await repoRoot(cwd)
  if (!root) return null
  const out = (await git(root, ['branch', '--show-current'])).trim()
  return out || null
}

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

export function parseWorktrees(out: string): GitWorktreeDetailed[] {
  const result: GitWorktreeDetailed[] = []
  let cur: GitWorktreeDetailed | null = null
  for (const line of out.split('\n')) {
    if (!line) {
      if (cur) result.push(cur)
      cur = null
      continue
    }
    const sp = line.indexOf(' ')
    const key = sp === -1 ? line : line.slice(0, sp)
    const value = sp === -1 ? '' : line.slice(sp + 1)
    if (key === 'worktree') {
      if (cur) result.push(cur)
      cur = {
        path: value,
        branch: null,
        head: '',
        main: result.length === 0,
        bare: false,
        detached: false,
        locked: false,
        prunable: false
      }
      continue
    }
    if (!cur) continue
    if (key === 'HEAD') cur.head = value
    else if (key === 'branch') cur.branch = value.replace(/^refs\/heads\//, '')
    else if (key === 'bare') cur.bare = true
    else if (key === 'detached') cur.detached = true
    else if (key === 'locked') cur.locked = true
    else if (key === 'prunable') cur.prunable = true
  }
  if (cur) result.push(cur)
  return result
}

export async function listWorktrees(cwd: string): Promise<GitWorktreeDetailed[]> {
  const root = await repoRoot(cwd)
  if (!root) return []
  return parseWorktrees(await git(root, ['worktree', 'list', '--porcelain']))
}

/** Raíz del repositorio principal (aunque `cwd` sea un worktree secundario). */
async function mainRoot(cwd: string): Promise<string> {
  const root = await requireRoot(cwd)
  const wts = await listWorktrees(root)
  return wts.find((w) => w.main)?.path ?? root
}

/**
 * Crea un worktree en `<repo>/../.<repoName>-worktrees/<branch>`.
 * Si la rama existe se hace checkout; si no, se crea desde `base` (o HEAD).
 */
export async function createWorktree(cwd: string, branch: string, base?: string): Promise<{ path: string; branch: string }> {
  const root = await mainRoot(cwd)
  await assertBranchName(root, branch)
  if (base !== undefined && (typeof base !== 'string' || !base || base.startsWith('-'))) {
    throw new GitError(t('common.git.invalidBase', { ref: String(base) }))
  }
  const folder = branch.replace(/[\\/]+/g, '-')
  const target = join(dirname(root), `.${basename(root)}-worktrees`, folder)
  if (existsSync(target)) throw new GitError(t('common.git.worktreeExists', { path: target }))

  const exists = await run(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { okCodes: [1] })
  const args =
    exists.code === 0 ? ['worktree', 'add', '--', target, branch] : ['worktree', 'add', '-b', branch, '--', target, ...(base ? [base] : [])]
  await git(root, args)
  return { path: target, branch }
}

export async function removeWorktree(cwd: string, path: string, force = false): Promise<void> {
  const root = await requireRoot(cwd)
  if (typeof path !== 'string' || !isAbsolute(path)) throw new GitError(t('common.git.invalidWorktreePath', { path: String(path) }))
  const target = realish(resolve(path))
  const wt = (await listWorktrees(root)).find((w) => samePath(realish(resolve(w.path)), target))
  if (!wt) throw new GitError(t('common.git.notWorktree', { path: target }))
  if (wt.main) throw new GitError(t('common.git.cantRemoveMain'))
  await git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', target])
}

// ---------------------------------------------------------------------------
// Commit / log
// ---------------------------------------------------------------------------

export async function commit(cwd: string, message: string, stageAll = false): Promise<GitCommitResult> {
  const root = await requireRoot(cwd)
  if (typeof message !== 'string' || !message.trim()) throw new GitError(t('common.git.emptyCommit'))
  if (stageAll) await git(root, ['add', '-A'])
  await git(root, ['commit', '-F', '-'], { input: message })
  const out = (await git(root, ['log', '-1', '--format=%H%x1f%h%x1f%s'])).trim()
  const [hash = '', shortHash = '', summary = ''] = out.split('\x1f')
  return { hash, shortHash, summary }
}

export async function log(cwd: string, n = 50): Promise<GitLogEntry[]> {
  const root = await repoRoot(cwd)
  if (!root) return []
  const count = Math.max(1, Math.min(Math.floor(Number(n) || 50), 1000))
  let out: string
  try {
    out = await git(root, ['log', `-n${count}`, '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1e'])
  } catch (err) {
    // Rama sin commits todavía.
    if (err instanceof GitError && /does not have any commits|bad default revision/i.test(err.stderr)) return []
    throw err
  }
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash = '', shortHash = '', author = '', email = '', at = '0', subject = ''] = r.split('\x1f')
      return { hash, shortHash, author, email, date: Number(at) * 1000, subject }
    })
}

// ---------------------------------------------------------------------------
// Descartar cambios (DESTRUCTIVO)
// ---------------------------------------------------------------------------
//
// Reglas: solo archivos que `git status` reporta como cambiados (nada ignorado ni fuera de la lista),
// ruta validada dentro del repo sin `..`, sin carpetas intermedias que sean enlaces simbólicos y sin
// tocar `.git`. Lo nuevo (sin seguimiento o añadido al índice) va a la Papelera, nunca se borra. Lo
// que tenía seguimiento se restaura desde HEAD tras copiar el contenido actual a `backupDir`, para
// poder «Rehacer». Se valida TODO antes de cambiar nada.

export interface DiscardDeps {
  /** Mueve a la Papelera (`shell.trashItem` en producción). */
  trash: (path: string) => Promise<void>
  /** Carpeta de copias para «Rehacer» (userData/code-discard). */
  backupDir: string
}

export const MAX_DISCARD_FILES = 200
const MAX_BACKUP_BYTES = 100 * 1024 * 1024
const BACKUP_TTL_MS = 7 * 24 * 3600 * 1000

interface DiscardTarget {
  rel: string
  abs: string
}

/** Ruta relativa al repo para descartar: valida escapes, `.git`, raíz y enlaces simbólicos intermedios. */
function discardTarget(root: string, p: string): DiscardTarget {
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new GitError(t('common.git.invalidFilePath'))
  if (p.split(/[\\/]/).includes('..')) throw new GitError(t('common.git.outsideRepo', { path: p }))
  const realRoot = realish(root)
  const abs0 = isAbsolute(p) ? resolve(p) : resolve(root, p)
  // El último componente NO se resuelve: si es un enlace simbólico se actúa sobre el enlace.
  const rel = relative(realRoot, join(realish(dirname(abs0)), basename(abs0)))
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) throw new GitError(t('common.git.outsideRepo', { path: p }))
  const parts = rel.split(sep)
  if (parts.some((x) => x === '.git' || x === '..' || x === '')) throw new GitError(t('common.git.discard.protectedPath', { path: p }))
  let cur = realRoot
  for (const part of parts.slice(0, -1)) {
    cur = join(cur, part)
    try {
      if (lstatSync(cur).isSymbolicLink()) throw new GitError(t('common.git.discard.symlinkDir', { path: p }))
    } catch (err) {
      if (err instanceof GitError) throw err
      break // aún no existe: nada que seguir
    }
  }
  return { rel: parts.join('/'), abs: join(realRoot, rel) }
}

interface UndoEntry {
  path: string
  /** Nombre de la copia o null = el archivo no existía (estaba borrado). */
  file: string | null
  mode: number
  /** Estado del índice que había (solo si tenía cambios preparados): se vuelve a preparar al deshacer. */
  index?: { state: 'blob'; oid: string; mode: string } | { state: 'deleted' }
  /** sha256 del archivo justo después de descartar (descarte por bloque): «Deshacer» solo si no cambió desde entonces. */
  afterHash?: string
}
interface UndoManifest {
  root: string
  createdAt: number
  entries: UndoEntry[]
}

function pruneBackups(dir: string): void {
  try {
    for (const name of readdirSync(dir)) {
      const m = join(dir, name)
      try {
        const man = JSON.parse(readFileSync(join(m, 'manifest.json'), 'utf8')) as UndoManifest
        if (Date.now() - man.createdAt > BACKUP_TTL_MS) rmSync(m, { recursive: true, force: true })
      } catch {
        // carpeta ajena o a medio escribir: se deja
      }
    }
  } catch {
    // aún no existe
  }
}

export async function discardChanges(
  cwd: string,
  paths: string[],
  deps: DiscardDeps,
  scope: 'all' | 'unstaged' = 'all'
): Promise<GitDiscardResult> {
  const root = await requireRoot(cwd)
  if (!Array.isArray(paths) || paths.length === 0) throw new GitError(t('common.git.discard.none'))
  if (paths.length > MAX_DISCARD_FILES) throw new GitError(t('common.git.discard.tooMany', { max: MAX_DISCARD_FILES }))
  const st = await status(root)
  const byPath = new Map(st.files.filter((f) => f.kind !== 'ignored').map((f) => [f.path, f]))

  // 1) Validación completa (no se cambia nada si algo no cuadra).
  const targets = new Map<string, DiscardTarget>()
  for (const p of paths) {
    const tg = discardTarget(root, p)
    targets.set(tg.rel, tg)
  }
  type TrackedItem = { tg: DiscardTarget; wasDeletedInTree: boolean; recordUndo: boolean; staged?: string }
  const tracked: TrackedItem[] = []
  const treeOnly: TrackedItem[] = []
  const added: DiscardTarget[] = []
  const untracked: DiscardTarget[] = []
  const seen = new Set<string>()
  for (const tg of targets.values()) {
    const f = byPath.get(tg.rel)
    if (!f) throw new GitError(t('common.git.discard.notChanged', { path: tg.rel }))
    if (f.conflicted) throw new GitError(t('common.git.discard.conflicted', { path: tg.rel }))
    seen.add(tg.rel)
    if (f.untracked) {
      untracked.push(tg)
      continue
    }
    if (scope === 'unstaged') {
      // Solo los cambios del árbol de trabajo vuelven a lo que hay en el índice: lo preparado se conserva.
      if (f.workingDir === ' ') throw new GitError(t('common.git.discard.notChanged', { path: tg.rel }))
      treeOnly.push({ tg, wasDeletedInTree: f.workingDir === 'D', recordUndo: true })
      continue
    }
    const isNew = [f.index, f.workingDir].some((c) => c === 'A' || c === 'R' || c === 'C')
    if (isNew) added.push(tg)
    else
      tracked.push({
        tg,
        wasDeletedInTree: f.workingDir === 'D' || f.index === 'D',
        recordUndo: true,
        staged: f.staged ? f.index : undefined
      })
    if (f.origPath) {
      // Renombre/copia: el origen también vuelve a su sitio (solo si es un renombre; una copia no lo toca).
      if (f.kind === 'renamed') {
        const o = discardTarget(root, f.origPath)
        if (!targets.has(o.rel) && !seen.has(o.rel)) {
          seen.add(o.rel)
          tracked.push({ tg: o, wasDeletedInTree: true, recordUndo: false })
        }
      }
    }
  }
  const tree = [...tracked.map((x) => x.tg.rel), ...treeOnly.map((x) => x.tg.rel), ...added.map((x) => x.rel)]
  if (tree.length) {
    const out = await git(root, ['ls-files', '--stage', '-z', '--', ...tree])
    for (const rec of out.split('\0').filter(Boolean)) {
      if (rec.startsWith('160000 ')) throw new GitError(t('common.git.discard.submodule', { path: rec.split('\t').slice(1).join('\t') }))
    }
  }

  // 2) Copias para «Rehacer» (solo lo que tenía seguimiento: lo nuevo va a la Papelera).
  const result: GitDiscardResult = { restored: [], trashed: [], failed: [], undoId: null }
  const entries: UndoEntry[] = []
  const undoId = randomUUID()
  const bdir = join(deps.backupDir, undoId)
  for (const { tg, wasDeletedInTree, recordUndo, staged } of [...tracked, ...treeOnly]) {
    if (!recordUndo) continue
    try {
      const index = staged === undefined ? undefined : await indexSnapshot(root, tg.rel, staged)
      if (wasDeletedInTree && !existsSync(tg.abs)) {
        entries.push({ path: tg.rel, file: null, mode: 0o644, ...(index ? { index } : {}) })
        continue
      }
      const ls = lstatSync(tg.abs)
      if (!ls.isFile() || ls.size > MAX_BACKUP_BYTES) continue // enlace/carpeta/enorme: sin «Rehacer» para este
      mkdirSync(bdir, { recursive: true, mode: 0o700 })
      const name = String(entries.length)
      copyFileSync(tg.abs, join(bdir, name))
      entries.push({ path: tg.rel, file: name, mode: ls.mode & 0o777, ...(index ? { index } : {}) })
    } catch {
      // sin copia: se descarta igualmente, sin «Rehacer» para este archivo
    }
  }

  // 3) Archivos con seguimiento: de vuelta a HEAD (índice y árbol).
  if (tracked.length) {
    try {
      await git(root, ['checkout', 'HEAD', '--', ...tracked.map((x) => x.tg.rel)])
      for (const x of tracked) if (x.recordUndo) result.restored.push(x.tg.rel)
    } catch (err) {
      for (const x of tracked) result.failed.push({ path: x.tg.rel, reason: (err as Error).message })
      entries.length = 0
    }
  }

  // 3b) Solo árbol de trabajo (lo preparado se conserva): vuelve a lo que hay en el índice.
  if (treeOnly.length) {
    try {
      await git(root, ['checkout', '--', ...treeOnly.map((x) => x.tg.rel)])
      for (const x of treeOnly) result.restored.push(x.tg.rel)
    } catch (err) {
      for (const x of treeOnly) result.failed.push({ path: x.tg.rel, reason: (err as Error).message })
    }
  }

  // 4) Lo añadido al índice: sale del índice y el archivo va a la Papelera.
  for (const tg of added) {
    try {
      await git(root, ['rm', '--cached', '-f', '-q', '--', tg.rel])
      await trashIfPresent(root, tg, deps, result)
    } catch (err) {
      result.failed.push({ path: tg.rel, reason: (err as Error).message })
    }
  }
  // 5) Sin seguimiento: a la Papelera.
  for (const tg of untracked) {
    try {
      await trashIfPresent(root, tg, deps, result)
    } catch (err) {
      result.failed.push({ path: tg.rel, reason: (err as Error).message })
    }
  }

  // Contenido que deja el descarte: «Deshacer» solo actúa si el archivo sigue siendo exactamente ese
  // (el estado de `git status` no sirve: con lo preparado conservado el archivo sigue figurando como cambiado).
  for (const e of entries) {
    try {
      e.afterHash = sha256(readFileSync(discardTarget(root, e.path).abs))
    } catch {
      // sin archivo tras descartar: la comprobación vuelve al estado de git
    }
  }

  const failedPaths = new Set(result.failed.map((f) => f.path))
  const undoable = entries.filter((e) => !failedPaths.has(e.path))
  if (undoable.length) {
    mkdirSync(bdir, { recursive: true, mode: 0o700 })
    const manifest: UndoManifest = { root: realish(root), createdAt: Date.now(), entries: undoable }
    writeFileSync(join(bdir, 'manifest.json'), JSON.stringify(manifest))
    result.undoId = undoId
  } else {
    rmSync(bdir, { recursive: true, force: true })
  }
  pruneBackups(deps.backupDir)
  return result
}

/** Estado del índice de un archivo con cambios preparados, para poder volver a prepararlo al deshacer. */
async function indexSnapshot(root: string, rel: string, indexLetter: string): Promise<UndoEntry['index'] | undefined> {
  if (indexLetter === 'D') return { state: 'deleted' }
  const out = await git(root, ['ls-files', '--stage', '-z', '--', rel])
  const m = /^(\d{6}) ([0-9a-f]{40,64}) 0\t/.exec(out)
  return m ? { state: 'blob', oid: m[2]!, mode: m[1]! } : undefined
}

/** Revalida la ruta justo antes de tocarla (evita carreras con enlaces) y la manda a la Papelera. */
async function trashIfPresent(root: string, tg: DiscardTarget, deps: DiscardDeps, result: GitDiscardResult): Promise<void> {
  const fresh = discardTarget(root, tg.rel)
  try {
    lstatSync(fresh.abs)
  } catch {
    return // ya no existe: nada que mover
  }
  try {
    await deps.trash(fresh.abs)
  } catch (err) {
    throw new GitError(t('common.git.discard.trashFailed', { reason: (err as Error).message }))
  }
  result.trashed.push(tg.rel)
}

/** «Rehacer»: devuelve el contenido que había antes de descartar, sin pisar lo que haya cambiado después. */
export async function undoDiscard(cwd: string, undoId: string, deps: DiscardDeps): Promise<GitDiscardUndoResult> {
  const root = await requireRoot(cwd)
  if (typeof undoId !== 'string' || !/^[0-9a-f-]{36}$/.test(undoId)) throw new GitError(t('common.git.discard.undoMissing'))
  const bdir = join(deps.backupDir, undoId)
  let manifest: UndoManifest
  try {
    manifest = JSON.parse(readFileSync(join(bdir, 'manifest.json'), 'utf8')) as UndoManifest
  } catch {
    throw new GitError(t('common.git.discard.undoMissing'))
  }
  if (manifest.root !== realish(root)) throw new GitError(t('common.git.discard.undoMissing'))
  const changed = new Set((await status(root)).files.filter((f) => f.kind !== 'ignored').map((f) => f.path))
  const result: GitDiscardUndoResult = { restored: [], failed: [] }
  for (const e of manifest.entries) {
    try {
      const tg = discardTarget(root, e.path)
      if (e.afterHash) {
        // Descarte por bloque: el archivo sigue modificado; se deshace solo si es exactamente lo que dejó el descarte.
        let now = ''
        try {
          now = sha256(readFileSync(tg.abs))
        } catch {
          // ausente: cambió
        }
        if (now !== e.afterHash) {
          result.failed.push({ path: tg.rel, reason: t('common.git.discard.undoChanged') })
          continue
        }
      } else if (changed.has(tg.rel)) {
        result.failed.push({ path: tg.rel, reason: t('common.git.discard.undoChanged') })
        continue
      }
      if (e.file === null) {
        // Estaba borrado en el árbol: se vuelve a quitar (a la Papelera, no definitivo).
        if (existsSync(tg.abs)) await deps.trash(tg.abs)
      } else {
        if (!/^\d+$/.test(e.file)) throw new GitError(t('common.git.discard.undoMissing'))
        mkdirSync(dirname(tg.abs), { recursive: true })
        copyFileSync(join(bdir, e.file), tg.abs)
        chmodSync(tg.abs, e.mode)
      }
      // Lo que estaba preparado vuelve a estarlo (el contenido se conserva en el repositorio como blob).
      if (e.index?.state === 'deleted') {
        await git(root, ['rm', '--cached', '-q', '--ignore-unmatch', '--', tg.rel])
      } else if (e.index?.state === 'blob') {
        if (!/^[0-7]{6}$/.test(e.index.mode) || !/^[0-9a-f]{40,64}$/.test(e.index.oid))
          throw new GitError(t('common.git.discard.undoMissing'))
        await git(root, ['update-index', '--add', '--cacheinfo', `${e.index.mode},${e.index.oid},${tg.rel}`])
      }
      result.restored.push(tg.rel)
    } catch (err) {
      result.failed.push({ path: e.path, reason: (err as Error).message })
    }
  }
  if (result.failed.length === 0) rmSync(bdir, { recursive: true, force: true })
  return result
}

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// ---------------------------------------------------------------------------
// Descartar UN bloque (hunk) de un archivo modificado (DESTRUCTIVO, todo o nada)
// ---------------------------------------------------------------------------
//
// Solo cambios del árbol de trabajo de un archivo regular ya seguido (lo preparado no se toca). Main
// recalcula el diff por su cuenta y exige que el bloque pedido sea idéntico al que vio el usuario (si el
// archivo cambió entretanto se rechaza). Antes de aplicar se guarda una copia completa del archivo y se
// comprueba `git apply -R --check`; `git apply` es atómico, así que o se descarta el bloque o no cambia nada.
// «Deshacer» reutiliza `undoDiscard`.

export async function discardHunk(
  cwd: string,
  path: string,
  index: number,
  hunk: string,
  deps: DiscardDeps
): Promise<GitDiscardHunkResult> {
  const root = await requireRoot(cwd)
  if (!Number.isInteger(index) || index < 0 || typeof hunk !== 'string' || !hunk) throw new GitError(t('common.git.discard.hunkStale'))
  const tg = discardTarget(root, path)
  const f = (await status(root)).files.find((x) => x.path === tg.rel)
  if (!f || f.untracked || f.conflicted || f.workingDir !== 'M' || f.kind === 'renamed' || f.kind === 'copied') {
    throw new GitError(t('common.git.discard.hunkNotModified', { path: tg.rel }))
  }
  const ls = lstatSync(tg.abs)
  if (!ls.isFile() || ls.size > MAX_BACKUP_BYTES) throw new GitError(t('common.git.discard.hunkTooBig', { path: tg.rel }))
  const patch = await diff({ cwd: root, path: tg.rel, staged: false })
  if (!isSingleFileDiff(patch)) throw new GitError(t('common.git.discard.hunkStale'))
  const split = splitDiffHunks(patch)
  if (split.hunks[index] !== hunk) throw new GitError(t('common.git.discard.hunkStale'))
  const reverse = split.header + hunk

  const undoId = randomUUID()
  const bdir = join(deps.backupDir, undoId)
  try {
    mkdirSync(bdir, { recursive: true, mode: 0o700 })
    copyFileSync(tg.abs, join(bdir, '0'))
    const before = sha256(readFileSync(tg.abs))
    if (sha256(readFileSync(join(bdir, '0'))) !== before) throw new GitError(t('common.git.discard.hunkStale'))
    await git(root, ['apply', '-R', '--check', '--whitespace=nowarn', '-'], { input: reverse })
    await git(root, ['apply', '-R', '--whitespace=nowarn', '-'], { input: reverse })
    const manifest: UndoManifest = {
      root: realish(root),
      createdAt: Date.now(),
      entries: [{ path: tg.rel, file: '0', mode: ls.mode & 0o777, afterHash: sha256(readFileSync(tg.abs)) }]
    }
    writeFileSync(join(bdir, 'manifest.json'), JSON.stringify(manifest))
  } catch (err) {
    rmSync(bdir, { recursive: true, force: true })
    if (err instanceof GitError && err.message.startsWith(t('common.git.discard.hunkStale'))) throw err
    throw new GitError(t('common.git.discard.hunkFailed', { reason: (err as Error).message }))
  }
  pruneBackups(deps.backupDir)
  return { undoId }
}
