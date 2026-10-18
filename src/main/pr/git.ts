/**
 * Parte `git` del flujo de PR: estado del repositorio, crear rama, plan de subida (con la revisión de secretos) y subida.
 * Reglas: `execFile` sin shell, nombres de rama/remoto con lista blanca, el remoto debe existir ya en el repositorio (nunca una URL),
 * jamás `--force` ni refspec con `+`, y la subida repite en main TODAS las comprobaciones sobre lo que la persona vio.
 */
import { isAbsolute, resolve } from 'node:path'
import { t } from '@shared/i18n'
import { maskSecretPatterns } from '@shared/redact-patterns'
import { scanDiffAdded } from '@shared/secret-scan'
import {
  checkBranchName,
  isProtectedBranch,
  isValidBranchName,
  isValidRemoteName,
  maskRemoteUrl,
  parseRemoteUrl
} from '@shared/pr-validate'
import type { PrChanges, PrWorkDiff, PrPushPlan, PrPushRequest, PrPushResult, PrRemote, PrRepoStatus, PushBlock } from '@shared/ipc-pr'
import { filterRawDiff } from '../remote/diff-filter'
import { isSensitivePath } from '../remote/path-guard'
import { diff as gitDiff, status as gitStatus } from '../git/service'
import { clipDiff, countFiles, formatStat, statFromDiff } from '@shared/pr-diff-lines'
import { PrError, runFile, minimalEnv, type RunOptions, type RunResult } from './exec'

const SAFE_GIT = ['-c', 'core.quotepath=off', '-c', 'core.fsmonitor=false']
const MAX_COMMITS_SCANNED = 500
const SCAN_BUFFER = 12 * 1024 * 1024
const PUSH_TIMEOUT = 120_000

export function perr(code: string, key: Parameters<typeof t>[0], params?: Record<string, string | number>): PrError {
  return new PrError(code, t(key, params))
}

/** `git` sin shell. Convierte «git no está» en un error entendible. */
export async function runGit(cwd: string, args: readonly string[], opts: RunOptions = {}): Promise<RunResult> {
  try {
    return await runFile('git', [...SAFE_GIT, ...args], { cwd, ...opts })
  } catch (e) {
    if (e instanceof PrError && e.code === 'not-found') throw perr('git-missing', 'common.git.notInstalled')
    if (e instanceof PrError && e.code === 'timeout') throw perr('timeout', 'pr.err.timeout')
    throw e
  }
}

async function gitOut(cwd: string, args: readonly string[], opts: RunOptions = {}): Promise<string> {
  const r = await runGit(cwd, args, opts)
  if (r.code !== 0)
    throw new PrError('git-failed', firstLines(r.stderr || r.stdout) || t('common.git.failed', { cmd: String(args[0]) }), r.stderr)
  return r.stdout
}

function firstLines(s: string, n = 3): string {
  return maskSecretPatterns(s.trim().split('\n').slice(-n).join('\n'))
}

/** Raíz del repo (ruta real). */
export async function repoRootOf(cwd: string): Promise<string> {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw perr('not-repo', 'common.git.invalidPath', { path: String(cwd) })
  const r = await runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (r.code !== 0 || !r.stdout.trim()) throw perr('not-repo', 'common.git.notRepo', { path: cwd })
  return r.stdout.trim()
}

export async function listRemotes(root: string): Promise<PrRemote[]> {
  const names = (await gitOut(root, ['remote']))
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 12)
  const out: PrRemote[] = []
  for (const name of names) {
    if (!isValidRemoteName(name)) continue
    // `host`/`slug` salen de la dirección de LECTURA (la que usa `gh` para saber de qué repositorio hablamos); `url`, la que se
    // muestra a la persona, es la de SUBIDA: es adonde realmente van los datos (puede ser distinta si el remoto tiene `pushurl`).
    const fetchRes = await runGit(root, ['remote', 'get-url', '--', name])
    const pushRes = await runGit(root, ['remote', 'get-url', '--push', '--', name])
    const rawFetch = fetchRes.code === 0 ? fetchRes.stdout.trim() : ''
    const rawPush = pushRes.code === 0 ? pushRes.stdout.trim() : rawFetch
    const parsed = rawFetch ? parseRemoteUrl(rawFetch) : null
    out.push({ name, url: maskSecretPatterns(maskRemoteUrl(rawPush)), host: parsed?.host ?? null, slug: parsed?.slug ?? null })
  }
  return out
}

async function requireRemote(root: string, remote: string): Promise<PrRemote> {
  if (!isValidRemoteName(remote)) throw perr('remote-unknown', 'pr.err.remoteUnknown', { remote: String(remote) })
  const found = (await listRemotes(root)).find((r) => r.name === remote)
  if (!found) throw perr('remote-unknown', 'pr.err.remoteUnknown', { remote })
  return found
}
export { requireRemote }

/** Rama predeterminada del remoto (`main`, `master`…) si el repositorio la conoce. */
export async function defaultBranchOf(root: string, remote: string): Promise<string | null> {
  if (!isValidRemoteName(remote)) return null
  const sym = await runGit(root, ['symbolic-ref', '--short', `refs/remotes/${remote}/HEAD`])
  if (sym.code === 0) {
    const name = sym.stdout.trim().replace(new RegExp(`^${remote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`), '')
    if (isValidBranchName(name)) return name
  }
  for (const guess of ['main', 'master']) {
    const r = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/remotes/${remote}/${guess}`])
    if (r.code === 0) return guess
  }
  return null
}

export async function repoStatus(cwd: string): Promise<PrRepoStatus> {
  let root: string
  try {
    root = await repoRootOf(cwd)
  } catch (e) {
    if (e instanceof PrError && e.code === 'not-repo') {
      return {
        isRepo: false,
        branch: null,
        head: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        dirtyCount: 0,
        remotes: [],
        defaultBranch: null,
        protected: false
      }
    }
    throw e
  }
  const st = await gitStatus(root)
  const remotes = await listRemotes(root)
  const preferred = remotes.find((r) => r.name === 'origin') ?? remotes[0]
  const defaultBranch = preferred ? await defaultBranchOf(root, preferred.name) : null
  const branch = st.detached ? null : st.branch
  const head = st.head && /^[0-9a-f]{40,64}$/.test(st.head) ? st.head : null
  return {
    isRepo: true,
    branch,
    head: head ?? (await currentHead(root)),
    upstream: st.upstream,
    ahead: st.ahead,
    behind: st.behind,
    dirtyCount: st.files.length,
    remotes,
    defaultBranch,
    protected: branch ? isProtectedBranch(branch, [defaultBranch]) : false
  }
}

async function currentHead(root: string): Promise<string | null> {
  const r = await runGit(root, ['rev-parse', '--verify', '-q', 'HEAD'])
  const sha = r.stdout.trim()
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null
}

async function currentBranchOf(root: string): Promise<string | null> {
  const out = (await gitOut(root, ['branch', '--show-current'])).trim()
  return out || null
}

/** Crea una rama nueva desde donde estás y cambia a ella (los cambios sin guardar se quedan contigo). Nunca borra ni mueve nada. */
export async function createBranch(cwd: string, name: string): Promise<{ branch: string }> {
  const check = checkBranchName(name)
  if (!check.ok) throw perr('branch-invalid', 'common.git.invalidBranch', { name: String(name) })
  const root = await repoRootOf(cwd)
  const exists = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
  if (exists.code === 0) throw perr('branch-exists', 'pr.err.branchExists', { name })
  if (!(await currentHead(root))) throw perr('no-commits', 'pr.err.noCommits')
  const fmt = await runGit(root, ['check-ref-format', '--branch', name])
  if (fmt.code !== 0) throw perr('branch-invalid', 'common.git.invalidBranch', { name })
  const r = await runGit(root, ['switch', '--create', name])
  if (r.code !== 0) throw new PrError('git-failed', firstLines(r.stderr || r.stdout), r.stderr)
  return { branch: name }
}

// ---------------------------------------------------------------------------
// Plan de subida (qué saldría del equipo) y subida
// ---------------------------------------------------------------------------

function outgoingRevs(remote: string): string[] {
  return ['HEAD', '--not', `--remotes=${remote}`]
}

export async function pushPlan(cwd: string, remoteName: string): Promise<PrPushPlan> {
  const root = await repoRootOf(cwd)
  const remote = await requireRemote(root, remoteName)
  const branch = await currentBranchOf(root)
  if (!branch) throw perr('detached', 'pr.err.detached')
  if (!isValidBranchName(branch)) throw perr('branch-invalid', 'pr.err.branchNotSupported', { name: branch })
  const head = await currentHead(root)
  if (!head) throw perr('no-commits', 'pr.err.noCommits')
  const defaultBranch = await defaultBranchOf(root, remote.name)

  const revs = outgoingRevs(remote.name)
  const count = Number((await gitOut(root, ['rev-list', '--count', ...revs])).trim()) || 0
  const logRaw = count > 0 ? await gitOut(root, ['log', '--format=%h%x1f%s', `--max-count=30`, ...revs]) : ''
  const commits = logRaw
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [short = '', subject = ''] = l.split('\x1f')
      return { short, subject: maskSecretPatterns(subject) }
    })

  const blocked: PushBlock[] = []
  let files: string[] = []
  if (count > 0) {
    const names = await runGit(
      root,
      ['log', '-z', '--name-only', '--no-renames', '--format=', `--max-count=${MAX_COMMITS_SCANNED}`, ...revs],
      {
        maxBuffer: SCAN_BUFFER
      }
    )
    if (names.code !== 0 || names.truncated) blocked.push({ kind: 'scan-incomplete' })
    files = [...new Set(names.stdout.split('\0').filter(Boolean))]
    for (const f of files) {
      if (isSensitivePath(resolve(root, f))) blocked.push({ kind: 'secret-file', file: f })
    }
    const patch = await runGit(
      root,
      ['log', '-p', '--no-color', '--no-ext-diff', '--no-renames', '--format=', `--max-count=${MAX_COMMITS_SCANNED}`, ...revs],
      {
        maxBuffer: SCAN_BUFFER
      }
    )
    if (patch.code !== 0 || patch.truncated || count > MAX_COMMITS_SCANNED) {
      if (!blocked.some((b) => b.kind === 'scan-incomplete')) blocked.push({ kind: 'scan-incomplete' })
    } else {
      for (const hit of scanDiffAdded(patch.stdout)) blocked.push({ kind: 'secret-content', file: hit.file, secrets: hit.kinds })
    }
  }

  const exists = await runGit(root, ['show-ref', '--verify', '--quiet', `refs/remotes/${remote.name}/${branch}`])
  const dirty = (await gitStatus(root)).files.length
  return {
    branch,
    head,
    remote: remote.name,
    remoteUrl: remote.url,
    host: remote.host,
    slug: remote.slug,
    commits,
    commitCount: count,
    fileCount: files.length,
    files: files.slice(0, 60),
    blocked,
    protected: isProtectedBranch(branch, [defaultBranch]),
    remoteBranchExists: exists.code === 0,
    nothingToPush: count === 0,
    dirtyCount: dirty
  }
}

/** Sube la rama actual al remoto elegido. Todo se vuelve a comprobar aquí: lo que la persona vio debe ser lo que se sube. */
export async function push(req: PrPushRequest): Promise<PrPushResult> {
  const plan = await pushPlan(req.cwd, req.remote)
  if (plan.branch !== req.branch) throw perr('changed', 'pr.err.branchChanged')
  if (plan.head !== req.expectHead) throw perr('changed', 'pr.err.headChanged')
  if (plan.blocked.length > 0) throw perr('blocked', 'pr.err.blocked')
  if (plan.nothingToPush) throw perr('nothing', 'pr.err.nothingToPush')
  if (plan.protected && req.typedBranch !== plan.branch) throw perr('protected-confirm', 'pr.err.protectedConfirm', { branch: plan.branch })
  const root = await repoRootOf(req.cwd)
  // Mismo nombre local y remoto; el refspec es explícito y nunca lleva `+` (no se fuerza nada).
  const refspec = `refs/heads/${plan.branch}:refs/heads/${plan.branch}`
  let r: RunResult
  try {
    r = await runGit(root, ['push', '--set-upstream', '--', plan.remote, refspec], { timeoutMs: PUSH_TIMEOUT, env: minimalEnv() })
  } catch (e) {
    if (e instanceof PrError && e.code === 'timeout') throw perr('timeout', 'pr.err.pushTimeout')
    throw e
  }
  const text = `${r.stderr}\n${r.stdout}`
  if (r.code !== 0) {
    if (/non-fast-forward|fetch first|rejected/i.test(text)) throw perr('rejected', 'pr.err.pushRejected')
    if (/could not read Username|Authentication failed|Permission denied|publickey|403|terminal prompts disabled/i.test(text)) {
      throw perr('auth', 'pr.err.pushAuth')
    }
    throw new PrError('push-failed', t('pr.err.pushFailed', { detail: firstLines(text) }), r.stderr)
  }
  return { branch: plan.branch, remote: plan.remote, head: plan.head, output: firstLines(text, 8) }
}

// ---------------------------------------------------------------------------
// Cambios de la rama frente a la base (para proponer el título y la descripción del PR)
// ---------------------------------------------------------------------------

const CHANGES_MAX_CHARS = 60_000

export async function branchChanges(cwd: string, remoteName: string, base: string): Promise<PrChanges> {
  if (!isValidBranchName(base)) throw perr('branch-invalid', 'common.git.invalidBranch', { name: String(base) })
  const root = await repoRootOf(cwd)
  const remote = await requireRemote(root, remoteName)
  let ref = `refs/remotes/${remote.name}/${base}`
  if ((await runGit(root, ['show-ref', '--verify', '--quiet', ref])).code !== 0) {
    ref = `refs/heads/${base}`
    if ((await runGit(root, ['show-ref', '--verify', '--quiet', ref])).code !== 0)
      throw perr('base-missing', 'pr.err.baseMissing', { base })
  }
  const log = await gitOut(root, ['log', '--format=%h%x1f%s', '--max-count=30', `${ref}..HEAD`])
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [short = '', subject = ''] = l.split('\x1f')
      return { short, subject: maskSecretPatterns(subject) }
    })
  const raw = await runGit(root, ['diff', '--no-color', '--no-ext-diff', '--no-renames', `${ref}...HEAD`], { maxBuffer: SCAN_BUFFER })
  const safe = filterRawDiff(raw.stdout, root)
  const clipped = clipDiff(safe, CHANGES_MAX_CHARS)
  return { base, commits, stat: formatStat(statFromDiff(safe)), diff: clipped.text, truncated: clipped.truncated || raw.truncated }
}

/** Cambios sin guardar (o solo los preparados), sin archivos sensibles: es lo que se le muestra a la IA para proponer el mensaje del commit. */
export async function workingDiff(cwd: string, staged?: boolean): Promise<PrWorkDiff> {
  const root = await repoRootOf(cwd)
  const raw = await gitDiff({ cwd: root, ...(staged === undefined ? {} : { staged }) })
  const safe = filterRawDiff(raw, root)
  const stats = statFromDiff(safe)
  const clipped = clipDiff(safe, CHANGES_MAX_CHARS)
  return {
    files: stats.map((s) => `M ${s.file}`).join('\n'),
    diff: clipped.text,
    truncated: clipped.truncated,
    omittedFiles: Math.max(0, countFiles(raw) - stats.length)
  }
}

/** Punta de `<remote>/<branch>` (o null si no existe). */
export async function remoteTip(root: string, remote: string, branch: string): Promise<string | null> {
  const r = await runGit(root, ['rev-parse', '--verify', '-q', `refs/remotes/${remote}/${branch}`])
  const sha = r.stdout.trim()
  return r.code === 0 && /^[0-9a-f]{40,64}$/.test(sha) ? sha : null
}

export { currentHead, currentBranchOf }
