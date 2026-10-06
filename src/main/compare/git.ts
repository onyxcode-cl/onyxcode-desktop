/**
 * Git para «Comparar modelos»: SIEMPRE `execFile('git', [...])` con argumentos en array (sin shell); el prompt y las
 * rutas nunca se interpolan en una línea de comandos. Los hooks del repositorio se desactivan en estas llamadas.
 * No importa `electron`.
 */
import { execFile } from 'node:child_process'
import { lstatSync, mkdirSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { t } from '@shared/i18n'

export class CompareGitError extends Error {
  constructor(
    message: string,
    readonly stderr = ''
  ) {
    super(message)
    this.name = 'CompareGitError'
  }
}

const TIMEOUT_MS = 120_000
const MAX_BUFFER = 256 * 1024 * 1024
const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null'

interface Out {
  stdout: Buffer
  stderr: string
  code: number
}

function runBuf(cwd: string, args: string[], opts: { input?: Buffer | string; okCodes?: number[] } = {}): Promise<Out> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      'git',
      ['-c', `core.hooksPath=${NULL_DEVICE}`, '-c', 'core.quotepath=off', ...args],
      {
        cwd,
        shell: false,
        maxBuffer: MAX_BUFFER,
        timeout: TIMEOUT_MS,
        encoding: 'buffer',
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', LANG: 'C' }
      },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null
        const errText = stderr.toString('utf8')
        if (e && e.code === 'ENOENT') return reject(new CompareGitError(t('common.git.notInstalled')))
        const code = e ? (typeof e.code === 'number' ? e.code : 1) : 0
        if (code !== 0 && !(opts.okCodes ?? []).includes(code)) {
          return reject(new CompareGitError(errText.trim().split('\n')[0] || `git ${args[0]} failed`, errText))
        }
        resolve({ stdout, stderr: errText, code })
      }
    )
    if (opts.input !== undefined) child.stdin?.end(opts.input)
    else child.stdin?.end()
  })
}

async function git(cwd: string, args: string[], opts?: { input?: Buffer | string; okCodes?: number[] }): Promise<string> {
  return (await runBuf(cwd, args, opts)).stdout.toString('utf8')
}

export function realDir(p: string): string {
  const real = realpathSync(p)
  if (!lstatSync(real).isDirectory()) throw new CompareGitError(t('merr.compare.notDir', { path: p }))
  return real
}

export interface RepoInfo {
  root: string
  head: string | null
  dirtyFiles: number
}

/** Raíz real del repositorio de `cwd` (o null si no es un repositorio). */
export async function repoRootOf(cwd: string): Promise<string | null> {
  const dir = realDir(cwd)
  try {
    const out = (await git(dir, ['rev-parse', '--show-toplevel'])).trim()
    return out ? realpathSync(out) : null
  } catch (err) {
    if (err instanceof CompareGitError && err.message === t('common.git.notInstalled')) throw err
    return null
  }
}

export async function headOf(root: string): Promise<string | null> {
  const r = await runBuf(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], { okCodes: [1] })
  const out = r.stdout.toString('utf8').trim()
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(out) ? out : null
}

/** Rutas con cambios sin confirmar (incluye archivos nuevos), relativas a la raíz y con `/`. */
export async function dirtyPaths(root: string): Promise<string[]> {
  const out = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  const parts = out.split('\0')
  const paths: string[] = []
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]
    if (rec.length < 4) continue
    const xy = rec.slice(0, 2)
    paths.push(rec.slice(3))
    // Renombrados/copiados: el siguiente campo es el origen.
    if (xy.includes('R') || xy.includes('C')) {
      i++
      if (parts[i]) paths.push(parts[i])
    }
  }
  return [...new Set(paths)]
}

export async function repoInfo(cwd: string): Promise<RepoInfo | null> {
  const root = await repoRootOf(cwd)
  if (!root) return null
  return { root, head: await headOf(root), dirtyFiles: (await dirtyPaths(root)).length }
}

export async function gitVersion(): Promise<string | null> {
  try {
    const out = (await git(process.cwd(), ['--version'])).trim()
    return /\d+\.\d+[\w.]*/.exec(out)?.[0] ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

export const BRANCH_PREFIX = 'lazunox-compare/'
/** Rama temporal de una columna: `lazunox-compare/<id8>-<n>`. */
export const BRANCH_RE = /^lazunox-compare\/[0-9a-f]{8}-[0-3]$/
const FOLDER_RE = /^lazunox-compare-[0-9a-f]{8}-[0-3]$/

export function branchFor(id8: string, n: number): string {
  return `${BRANCH_PREFIX}${id8}-${n}`
}

/** `<repo>/../.<repo>-worktrees`: carpeta hermana, fuera del repositorio (como `git:createWorktree`). */
export function worktreesDirFor(root: string): string {
  return join(dirname(root), `.${basename(root)}-worktrees`)
}

export function worktreePathFor(root: string, id8: string, n: number): string {
  return join(worktreesDirFor(root), `lazunox-compare-${id8}-${n}`)
}

/** ¿`path` es exactamente una carpeta de copia que esta función habría creado para `root`? */
export function isCompareWorktreePath(root: string, path: string): boolean {
  return dirname(path) === worktreesDirFor(root) && FOLDER_RE.test(basename(path))
}

function assertNotSymlink(p: string): void {
  let st
  try {
    st = lstatSync(p)
  } catch {
    return
  }
  if (st.isSymbolicLink() || !st.isDirectory()) throw new CompareGitError(t('merr.compare.unsafePath', { path: p }))
}

export async function createCompareWorktree(root: string, path: string, branch: string, base: string): Promise<void> {
  if (!BRANCH_RE.test(branch) || !isCompareWorktreePath(root, path)) throw new CompareGitError(t('merr.compare.unsafePath', { path }))
  const parent = worktreesDirFor(root)
  assertNotSymlink(parent)
  mkdirSync(parent, { recursive: true })
  assertNotSymlink(parent)
  const existed = (await runBuf(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { okCodes: [1] })).code === 0
  try {
    await git(root, ['worktree', 'add', '-b', branch, '--', path, base])
  } catch (err) {
    // `worktree add -b` puede dejar la rama creada si falla después: se borra solo si no existía antes.
    if (!existed) await runBuf(root, ['branch', '-D', '--', branch], { okCodes: [1] }).catch(() => undefined)
    throw err
  }
}

/** Borra la copia (`--force`) y la rama temporal. Tolera que alguna de las dos ya no exista. */
export async function removeCompareWorktree(root: string, path: string, branch: string): Promise<void> {
  if (!BRANCH_RE.test(branch) || !isCompareWorktreePath(root, path)) throw new CompareGitError(t('merr.compare.unsafePath', { path }))
  assertNotSymlink(path)
  const listed = (await git(root, ['worktree', 'list', '--porcelain'])).split('\n').some((l) => l === `worktree ${path}`)
  if (listed) await git(root, ['worktree', 'remove', '--force', '--', path])
  await git(root, ['worktree', 'prune'])
  const exists = await runBuf(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { okCodes: [1] })
  if (exists.code === 0) await git(root, ['branch', '-D', '--', branch])
}

export async function pruneWorktrees(root: string): Promise<void> {
  await git(root, ['worktree', 'prune'])
}

// ---------------------------------------------------------------------------
// Parche
// ---------------------------------------------------------------------------

export interface PatchSnapshot {
  /** Parche completo (bytes tal cual: puede no ser UTF-8). */
  patch: Buffer
  files: string[]
  additions: number
  deletions: number
  /** Algún archivo es un enlace simbólico. */
  hasSymlink: boolean
}

const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/']

/**
 * `git add -A` (índice del worktree, que es nuestro) y diff contra la base, con archivos nuevos y binarios.
 * `worktree` debe ser una copia de comparación de `root`.
 */
export async function snapshotPatch(root: string, worktree: string, base: string): Promise<PatchSnapshot> {
  if (!isCompareWorktreePath(root, worktree)) throw new CompareGitError(t('merr.compare.unsafePath', { path: worktree }))
  assertNotSymlink(worktree)
  await git(worktree, ['add', '-A'])
  const patch = (await runBuf(worktree, ['diff', '--cached', '--binary', ...DIFF_FLAGS, base])).stdout
  const num = await git(worktree, ['diff', '--cached', '--numstat', '-z', ...DIFF_FLAGS, base])
  const raw = await git(worktree, ['diff', '--cached', '--raw', '-z', ...DIFF_FLAGS, base])
  const files: string[] = []
  let additions = 0
  let deletions = 0
  for (const rec of num.split('\0')) {
    if (!rec) continue
    const m = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(rec)
    if (!m) continue
    files.push(m[3])
    if (m[1] !== '-') additions += Number(m[1])
    if (m[2] !== '-') deletions += Number(m[2])
  }
  let hasSymlink = false
  const rparts = raw.split('\0')
  for (let i = 0; i + 1 < rparts.length; i += 2) {
    const meta = rparts[i]
    if (/^:(\d+) (\d+) /.exec(meta)?.slice(1, 3).includes('120000')) hasSymlink = true
  }
  return { patch, files, additions, deletions, hasSymlink }
}

export type ApplyCheck = { ok: true } | { ok: false; files: string[] }

/** `git apply --check` (sin `--3way` ni `--reject`). No toca nada. */
export async function applyCheck(root: string, patch: Buffer): Promise<ApplyCheck> {
  try {
    await git(root, ['apply', '--check', '--binary', '--whitespace=nowarn', '-'], { input: patch })
    return { ok: true }
  } catch (err) {
    const stderr = err instanceof CompareGitError ? err.stderr : ''
    const files = new Set<string>()
    for (const line of stderr.split('\n')) {
      const m =
        /^error: (?:patch failed: )?(.+?)(?::\d+)?(?::| )(?:patch does not apply|already exists|does not exist|does not match)/.exec(line)
      if (m) files.add(m[1])
    }
    return { ok: false, files: [...files] }
  }
}

/** Aplica el parche entero al árbol de trabajo, sin índice ni commit (atómico: o entra todo o no entra nada). */
export async function applyPatch(root: string, patch: Buffer): Promise<void> {
  await git(root, ['apply', '--binary', '--whitespace=nowarn', '-'], { input: patch })
}
