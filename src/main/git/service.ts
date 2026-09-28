/**
 * Git vía `child_process.execFile('git', ...)` — sin shell, sin dependencias extra.
 * No importa `electron`, así que puede probarse con Node puro.
 */
import { execFile } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type {
  GitBranch,
  GitChangeKind,
  GitCommitResult,
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
        if (e.code === 'ENOENT') return reject(new GitError('git no está instalado o no está en el PATH'))
        const code = typeof e.code === 'number' ? e.code : null
        if (code !== null && opts.okCodes?.includes(code)) return resolvePromise({ stdout, stderr, code })
        const msg = (stderr.trim() || stdout.trim() || e.message).trim().split('\n').slice(-3).join('\n')
        reject(new GitError(msg || `git ${args[0]} falló`, stderr, code))
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
  if (typeof cwd !== 'string' || !cwd || !isAbsolute(cwd)) throw new GitError(`Ruta inválida: ${String(cwd)}`)
  const abs = resolve(cwd)
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new GitError(`La carpeta no existe: ${abs}`)
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
  if (typeof p !== 'string' || !p || p.includes('\0')) throw new GitError('Ruta de archivo inválida')
  const abs = realish(isAbsolute(p) ? resolve(p) : resolve(root, p))
  const rel = relative(realish(root), abs)
  if (rel === '') return '.'
  if (rel.startsWith('..') || isAbsolute(rel)) throw new GitError(`La ruta está fuera del repositorio: ${p}`)
  return rel.split(sep).join('/')
}

async function assertBranchName(cwd: string, name: string): Promise<void> {
  if (typeof name !== 'string' || !name.trim() || name.startsWith('-') || /[\s\0]/.test(name)) {
    throw new GitError(`Nombre de rama inválido: ${String(name)}`)
  }
  try {
    await git(cwd, ['check-ref-format', '--branch', name])
  } catch {
    throw new GitError(`Nombre de rama inválido: ${name}`)
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
    if (err instanceof GitError && err.message.includes('git no está instalado')) throw err
    return null
  }
}

export async function isRepo(cwd: string): Promise<boolean> {
  return (await repoRoot(cwd)) !== null
}

async function requireRoot(cwd: string): Promise<string> {
  const root = await repoRoot(cwd)
  if (!root) throw new GitError(`No es un repositorio git: ${cwd}`)
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
  const out = await git(root, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'])
  return parseStatusV2(out, root)
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

const DIFF_FLAGS = ['--no-color', '--no-ext-diff', '--no-textconv', '--find-renames']

async function untrackedFiles(root: string, rel?: string): Promise<string[]> {
  const args = ['ls-files', '--others', '--exclude-standard', '-z']
  if (rel) args.push('--', rel)
  const out = await git(root, args)
  return out.split('\0').filter(Boolean)
}

async function untrackedDiff(root: string, file: string): Promise<string> {
  // --no-index sale con 1 cuando hay diferencias.
  const out = await git(root, ['diff', '--no-index', '--no-color', '--no-ext-diff', '--', '/dev/null', file], {
    okCodes: [1]
  })
  return out
}

export async function diff(req: GitDiffRequest): Promise<string> {
  const root = await repoRoot(req.cwd)
  if (!root) return ''
  const rel = req.path ? toRepoPath(root, req.path) : undefined
  const pathArgs = rel ? ['--', rel] : []
  const parts: string[] = []

  if (req.staged !== false) {
    parts.push(await git(root, ['diff', '--cached', ...DIFF_FLAGS, ...pathArgs]))
  }
  if (req.staged !== true) {
    parts.push(await git(root, ['diff', ...DIFF_FLAGS, ...pathArgs]))
    const files = await untrackedFiles(root, rel)
    for (const f of files.slice(0, MAX_UNTRACKED_DIFFS)) {
      try {
        parts.push(await untrackedDiff(root, f))
      } catch {
        // archivo desaparecido o ilegible: se omite
      }
    }
    if (files.length > MAX_UNTRACKED_DIFFS) {
      parts.push(`# ${files.length - MAX_UNTRACKED_DIFFS} archivos sin seguimiento adicionales omitidos\n`)
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
export async function createWorktree(
  cwd: string,
  branch: string,
  base?: string
): Promise<{ path: string; branch: string }> {
  const root = await mainRoot(cwd)
  await assertBranchName(root, branch)
  if (base !== undefined && (typeof base !== 'string' || !base || base.startsWith('-'))) {
    throw new GitError(`Referencia base inválida: ${String(base)}`)
  }
  const folder = branch.replace(/[\\/]+/g, '-')
  const target = join(dirname(root), `.${basename(root)}-worktrees`, folder)
  if (existsSync(target)) throw new GitError(`Ya existe la carpeta del worktree: ${target}`)

  const exists = await run(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { okCodes: [1] })
  const args =
    exists.code === 0
      ? ['worktree', 'add', '--', target, branch]
      : ['worktree', 'add', '-b', branch, '--', target, ...(base ? [base] : [])]
  await git(root, args)
  return { path: target, branch }
}

export async function removeWorktree(cwd: string, path: string, force = false): Promise<void> {
  const root = await requireRoot(cwd)
  if (typeof path !== 'string' || !isAbsolute(path)) throw new GitError(`Ruta de worktree inválida: ${String(path)}`)
  const target = realish(resolve(path))
  const wt = (await listWorktrees(root)).find((w) => realish(resolve(w.path)) === target)
  if (!wt) throw new GitError(`No es un worktree de este repositorio: ${target}`)
  if (wt.main) throw new GitError('No se puede eliminar el worktree principal')
  await git(root, ['worktree', 'remove', ...(force ? ['--force'] : []), '--', target])
}

// ---------------------------------------------------------------------------
// Commit / log
// ---------------------------------------------------------------------------

export async function commit(cwd: string, message: string, stageAll = false): Promise<GitCommitResult> {
  const root = await requireRoot(cwd)
  if (typeof message !== 'string' || !message.trim()) throw new GitError('El mensaje de commit está vacío')
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
