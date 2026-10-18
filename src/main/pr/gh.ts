/**
 * Parte `gh` (CLI oficial de GitHub) del flujo de PR. Lazunox NUNCA ve ni guarda un token de GitHub: usa la sesión que la persona
 * ya inició con `gh auth login`. Si `gh` falta o no tiene sesión, se dice con claridad y no se inventa nada.
 * Todo `gh` se ejecuta por ruta absoluta, sin shell, con entorno mínimo (sin tokens heredados) y con tiempo límite.
 */
import { t } from '@shared/i18n'
import { maskSecretPatterns } from '@shared/redact-patterns'
import { isGithubHost, isValidSlug, parsePrRef } from '@shared/pr-validate'
import type {
  PrCheck,
  PrCheckState,
  PrCreateRequest,
  PrCreateResult,
  PrGhInfo,
  PrInfo,
  PrPostReviewRequest,
  PrPostReviewResult,
  PrReviewInfo,
  PrViewResult
} from '@shared/ipc-pr'
import { filterRawDiff } from '../remote/diff-filter'
import { isSensitivePath } from '../remote/path-guard'
import { clipDiff, countFiles, rightSideLines } from '@shared/pr-diff-lines'
import { PrError, findGh, runFile, type RunResult } from './exec'
import { currentBranchOf, currentHead, perr, remoteTip, repoRootOf, requireRemote } from './git'
import { resolve } from 'node:path'

const GH_TIMEOUT = 45_000
const REVIEW_DIFF_MAX = 400_000
const REVIEW_DIFF_BUFFER = 8 * 1024 * 1024
const PR_BODY_MAX = 20_000

async function gh(cwd: string, args: readonly string[], input?: string, buffer?: number): Promise<RunResult> {
  const bin = findGh({ projectDir: cwd })
  if (!bin) throw perr('gh-missing', 'pr.err.ghMissing')
  try {
    return await runFile(bin, args, { cwd, timeoutMs: GH_TIMEOUT, input, maxBuffer: buffer })
  } catch (e) {
    if (e instanceof PrError && e.code === 'not-found') throw perr('gh-missing', 'pr.err.ghMissing')
    if (e instanceof PrError && e.code === 'timeout') throw perr('timeout', 'pr.err.timeout')
    throw e
  }
}

function ghFailure(r: RunResult): PrError {
  const detail = maskSecretPatterns((r.stderr || r.stdout).trim().split('\n').slice(-3).join('\n'))
  if (/not logged in|gh auth login|authentication|HTTP 401|bad credentials/i.test(r.stderr))
    return perr('gh-unauthenticated', 'pr.err.ghUnauth')
  return new PrError('gh-failed', t('pr.err.ghFailed', { detail }), r.stderr)
}

/** ¿`gh` está instalada y con sesión iniciada? No lee ni muestra ningún token. */
export async function ghInfo(cwd: string, host: string | null): Promise<PrGhInfo> {
  if (host && !isGithubHost(host)) return { state: 'unsupported-host', account: null }
  const bin = findGh({ projectDir: cwd })
  if (!bin) return { state: 'missing', account: null }
  let r: RunResult
  try {
    r = await runFile(bin, ['auth', 'status', '--hostname', 'github.com'], { cwd, timeoutMs: 20_000 })
  } catch (e) {
    if (e instanceof PrError && e.code === 'not-found') return { state: 'missing', account: null }
    throw e
  }
  if (r.code !== 0) return { state: 'unauthenticated', account: null }
  const m = /account\s+([A-Za-z0-9_.-]{1,100})/.exec(`${r.stdout}\n${r.stderr}`)
  return { state: 'ready', account: m ? m[1] : null }
}

/** `owner/repo` del remoto elegido; solo GitHub. */
async function slugOf(root: string, remoteName: string): Promise<string> {
  const remote = await requireRemote(root, remoteName)
  if (!remote.host || !isGithubHost(remote.host)) throw perr('not-github', 'pr.err.notGithub', { host: remote.host ?? remote.url })
  if (!isValidSlug(remote.slug)) throw perr('not-github', 'pr.err.notGithub', { host: remote.host })
  return remote.slug
}

function checkState(c: Record<string, unknown>): PrCheckState {
  const status = String(c.status ?? '').toUpperCase()
  const conclusion = String(c.conclusion ?? c.state ?? '').toUpperCase()
  if (c.__typename === 'StatusContext') {
    if (conclusion === 'SUCCESS') return 'success'
    if (conclusion === 'PENDING' || conclusion === 'EXPECTED') return 'pending'
    return 'failure'
  }
  if (status && status !== 'COMPLETED') return 'pending'
  switch (conclusion) {
    case 'SUCCESS':
      return 'success'
    case 'NEUTRAL':
      return 'neutral'
    case 'SKIPPED':
      return 'skipped'
    case '':
      return 'pending'
    default:
      return 'failure'
  }
}

const SAFE_URL = /^https:\/\/[A-Za-z0-9.-]+\/[^\s]*$/

export function parsePrJson(raw: string): PrInfo | null {
  let j: unknown
  try {
    j = JSON.parse(raw)
  } catch {
    return null
  }
  if (!j || typeof j !== 'object') return null
  const o = j as Record<string, unknown>
  if (typeof o.number !== 'number' || typeof o.url !== 'string' || !SAFE_URL.test(o.url)) return null
  const rollup = Array.isArray(o.statusCheckRollup) ? (o.statusCheckRollup as Record<string, unknown>[]) : []
  const checks: PrCheck[] = rollup.slice(0, 60).map((c) => {
    const url = typeof c.detailsUrl === 'string' ? c.detailsUrl : typeof c.targetUrl === 'string' ? c.targetUrl : null
    return {
      name: maskSecretPatterns(String(c.name ?? c.context ?? c.workflowName ?? '?').slice(0, 120)),
      state: checkState(c),
      url: url && SAFE_URL.test(url) ? url : null
    }
  })
  const st = String(o.state ?? '').toUpperCase()
  const author = o.author && typeof o.author === 'object' ? (o.author as Record<string, unknown>).login : null
  return {
    number: o.number,
    title: maskSecretPatterns(String(o.title ?? '').slice(0, 300)),
    state: st === 'MERGED' ? 'merged' : st === 'CLOSED' ? 'closed' : 'open',
    url: o.url,
    isDraft: o.isDraft === true,
    base: String(o.baseRefName ?? ''),
    head: String(o.headRefName ?? ''),
    author: typeof author === 'string' ? author : null,
    reviewDecision: typeof o.reviewDecision === 'string' && o.reviewDecision ? o.reviewDecision : null,
    checks
  }
}

const VIEW_FIELDS = 'number,title,state,url,isDraft,baseRefName,headRefName,author,reviewDecision,statusCheckRollup'

/** PR de una rama (con el estado de sus comprobaciones). `pr: null` si todavía no existe. */
export async function viewBranchPr(cwd: string, remoteName: string, branch: string): Promise<PrViewResult> {
  const root = await repoRootOf(cwd)
  const slug = await slugOf(root, remoteName)
  const r = await gh(root, ['pr', 'view', branch, '--repo', slug, '--json', VIEW_FIELDS])
  if (r.code !== 0) {
    if (/no pull requests? found/i.test(r.stderr)) return { pr: null }
    throw ghFailure(r)
  }
  const pr = parsePrJson(r.stdout)
  if (!pr) throw perr('gh-failed', 'pr.err.ghBadAnswer')
  return { pr }
}

/** Abre el pull request. La rama debe estar ya subida y ser exactamente la que la persona vio. */
export async function createPr(req: PrCreateRequest): Promise<PrCreateResult> {
  const root = await repoRootOf(req.cwd)
  const slug = await slugOf(root, req.remote)
  const branch = await currentBranchOf(root)
  if (!branch || branch !== req.branch) throw perr('changed', 'pr.err.branchChanged')
  const head = await currentHead(root)
  if (!head || head !== req.expectHead) throw perr('changed', 'pr.err.headChanged')
  if (req.base === req.branch) throw perr('same-branch', 'pr.err.sameBranch')
  const tip = await remoteTip(root, req.remote, req.branch)
  if (tip !== head) throw perr('not-pushed', 'pr.err.notPushed')
  const title = maskSecretPatterns(req.title.trim())
  const body = maskSecretPatterns(req.body)
  const args = ['pr', 'create', '--repo', slug, '--base', req.base, '--head', req.branch, '--title', title, '--body-file', '-']
  if (req.draft) args.push('--draft')
  const r = await gh(root, args, body)
  if (r.code !== 0) {
    const already = /already exists/i.test(r.stderr)
    if (already) throw perr('exists', 'pr.err.prExists')
    throw ghFailure(r)
  }
  const m = /https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/(\d+)/.exec(r.stdout)
  if (!m) throw perr('gh-failed', 'pr.err.ghBadAnswer')
  return { url: m[0], number: Number(m[1]) }
}

// ---------------------------------------------------------------------------
// Revisión
// ---------------------------------------------------------------------------

function resolveRef(slugOfRemote: string, ref: string): number {
  const p = parsePrRef(ref)
  if (!p.ok) throw perr('pr-ref', p.problem === 'host' ? 'pr.err.refHost' : 'pr.err.refFormat')
  if (p.slug && p.slug.toLowerCase() !== slugOfRemote.toLowerCase()) throw perr('other-repo', 'pr.err.otherRepo', { repo: p.slug })
  return p.number
}

async function prDiff(root: string, slug: string, n: number): Promise<{ text: string; truncated: boolean }> {
  const d = await gh(root, ['pr', 'diff', String(n), '--repo', slug, '--color', 'never'], undefined, REVIEW_DIFF_BUFFER)
  if (d.code !== 0) throw ghFailure(d)
  return { text: d.stdout, truncated: d.truncated }
}

async function prMeta(root: string, slug: string, n: number): Promise<Record<string, unknown>> {
  const m = await gh(root, [
    'pr',
    'view',
    String(n),
    '--repo',
    slug,
    '--json',
    'number,title,body,author,baseRefName,headRefName,headRefOid,url,state,isDraft'
  ])
  if (m.code !== 0) throw ghFailure(m)
  try {
    return JSON.parse(m.stdout) as Record<string, unknown>
  } catch {
    throw perr('gh-failed', 'pr.err.ghBadAnswer')
  }
}

/** Datos de un PR (propio o ajeno) para revisarlo. Todo lo que trae es DATO: se entrega con el diff ya sin archivos sensibles. */
export async function reviewInfo(cwd: string, remoteName: string, ref: string): Promise<PrReviewInfo> {
  const root = await repoRootOf(cwd)
  const slug = await slugOf(root, remoteName)
  const n = resolveRef(slug, ref)
  const meta = await prMeta(root, slug, n)
  const diff = await prDiff(root, slug, n)
  const before = countFiles(diff.text)
  const safe = filterRawDiff(diff.text, root)
  const omitted = before - countFiles(safe)
  const clipped = clipDiff(safe, REVIEW_DIFF_MAX)
  const author = meta.author && typeof meta.author === 'object' ? (meta.author as Record<string, unknown>).login : null
  const sha = String(meta.headRefOid ?? '')
  const url = String(meta.url ?? '')
  if (!/^[0-9a-f]{40,64}$/.test(sha) || !SAFE_URL.test(url)) throw perr('gh-failed', 'pr.err.ghBadAnswer')
  return {
    number: n,
    title: String(meta.title ?? '').slice(0, 300),
    body: String(meta.body ?? '').slice(0, PR_BODY_MAX),
    author: typeof author === 'string' ? author : null,
    base: String(meta.baseRefName ?? ''),
    head: String(meta.headRefName ?? ''),
    headSha: sha,
    url,
    state: String(meta.state ?? ''),
    isDraft: meta.isDraft === true,
    diff: clipped.text,
    truncated: clipped.truncated || diff.truncated,
    omittedFiles: omitted
  }
}

/**
 * Publica UNA revisión de tipo «comentario» (nunca aprueba ni pide cambios) con el resumen y los comentarios que la persona
 * aprobó. Los comentarios cuya línea no está en el diff se incluyen en el resumen. Todo texto pasa por el tapado de secretos.
 */
export async function postReview(req: PrPostReviewRequest): Promise<PrPostReviewResult> {
  const root = await repoRootOf(req.cwd)
  const slug = await slugOf(root, req.remote)
  const meta = await prMeta(root, slug, req.number)
  if (String(meta.state ?? '').toUpperCase() !== 'OPEN') throw perr('pr-closed', 'pr.err.prClosed')
  if (String(meta.headRefOid ?? '') !== req.headSha) throw perr('pr-changed', 'pr.err.prChanged')
  const diff = await prDiff(root, slug, req.number)
  const lines = rightSideLines(filterRawDiff(diff.text, root))
  const inline: Array<{ path: string; line: number; side: 'RIGHT'; body: string }> = []
  const loose: string[] = []
  for (const c of req.comments) {
    const body = maskSecretPatterns(c.body.trim())
    if (!body) continue
    const known = lines.get(c.path)
    const safePath = c.path.replace(/`/g, '')
    if (c.line > 0 && known?.has(c.line) && !isSensitivePath(resolve(root, c.path))) {
      inline.push({ path: c.path, line: c.line, side: 'RIGHT', body })
    } else if (!isSensitivePath(resolve(root, c.path))) loose.push(`- \`${safePath}${c.line > 0 ? `:${c.line}` : ''}\` — ${body}`)
  }
  let summary = maskSecretPatterns(req.summary.trim())
  if (loose.length > 0) summary = [summary, loose.join('\n')].filter(Boolean).join('\n\n')
  if (!summary && inline.length === 0) throw perr('empty-review', 'pr.err.emptyReview')
  const payload = JSON.stringify({ commit_id: req.headSha, event: 'COMMENT', body: summary, comments: inline })
  const r = await gh(root, ['api', '--method', 'POST', `repos/${slug}/pulls/${req.number}/reviews`, '--input', '-'], payload)
  if (r.code !== 0) throw ghFailure(r)
  let url: string | null = null
  try {
    const u = (JSON.parse(r.stdout) as Record<string, unknown>).html_url
    url = typeof u === 'string' && SAFE_URL.test(u) ? u : null
  } catch {
    url = null
  }
  return { url, inline: inline.length, inSummary: loose.length }
}
