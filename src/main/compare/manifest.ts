/**
 * Manifiesto persistente de las comparaciones: `<userData>/compare/<id>.json`, escritura atómica (tmp + rename), 0600.
 * Un archivo corrupto o con forma inválida se ignora (y se registra). No importa `electron`.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { CompareColumnManifest, CompareColumnState, CompareErrorKind, CompareManifest, CompareMetrics } from '@shared/ipc-code'
import { BRANCH_RE } from './git'
import { emptyMetrics } from './metrics'

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATES: readonly CompareColumnState[] = ['queued', 'starting', 'running', 'done', 'error', 'rateLimited', 'cancelled']
const ERROR_KINDS = ['no-ai', 'model-not-found', 'auth', 'network', 'quota', 'context', 'unknown']
const PERMS = ['manual', 'acceptEdits', 'auto', 'bypass']

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function parseMetrics(v: unknown): CompareMetrics {
  const base = emptyMetrics()
  if (!isObj(v)) return base
  return {
    inputTokens: optNum(v.inputTokens),
    outputTokens: optNum(v.outputTokens),
    reasoningTokens: optNum(v.reasoningTokens),
    cacheReadTokens: optNum(v.cacheReadTokens),
    cacheWriteTokens: optNum(v.cacheWriteTokens),
    costUsd: optNum(v.costUsd),
    llmCalls: optNum(v.llmCalls) ?? 0,
    durationMs: optNum(v.durationMs)
  }
}

function parseColumn(v: unknown, mode: 'code' | 'chat'): CompareColumnManifest | null {
  if (!isObj(v)) return null
  const index = v.index
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index > 3) return null
  const m = v.model
  if (!isObj(m) || typeof m.providerID !== 'string' || typeof m.modelID !== 'string' || !m.providerID || !m.modelID) return null
  if (typeof v.state !== 'string' || !STATES.includes(v.state as CompareColumnState)) return null
  let worktree: CompareColumnManifest['worktree'] = null
  if (v.worktree !== null && v.worktree !== undefined) {
    const w = v.worktree
    if (!isObj(w) || typeof w.path !== 'string' || !isAbsolute(w.path) || typeof w.branch !== 'string' || !BRANCH_RE.test(w.branch))
      return null
    worktree = { path: w.path, branch: w.branch }
  }
  if (mode === 'code' && !worktree && v.discarded !== true) return null
  const e = v.error
  const error =
    isObj(e) && typeof e.message === 'string' && typeof e.kind === 'string' && ERROR_KINDS.includes(e.kind)
      ? { kind: e.kind as CompareErrorKind, message: e.message }
      : null
  const d = v.diff
  const diff =
    isObj(d) && optNum(d.files) !== null && optNum(d.additions) !== null && optNum(d.deletions) !== null
      ? { files: d.files as number, additions: d.additions as number, deletions: d.deletions as number }
      : null
  return {
    index,
    model: { providerID: m.providerID, modelID: m.modelID, ...(typeof m.variant === 'string' && m.variant ? { variant: m.variant } : {}) },
    sessionID: optStr(v.sessionID),
    worktree,
    state: v.state as CompareColumnState,
    adopted: v.adopted === true,
    discarded: v.discarded === true,
    startedAt: optNum(v.startedAt),
    finishedAt: optNum(v.finishedAt),
    metrics: parseMetrics(v.metrics),
    error,
    retryAt: optNum(v.retryAt),
    retried: v.retried === true,
    stopUnconfirmed: v.stopUnconfirmed === true,
    interrupted: v.interrupted === true,
    diff
  }
}

/** Valida y normaliza un manifiesto leído de disco (`null` si no es válido). */
export function parseManifest(raw: unknown): CompareManifest | null {
  if (!isObj(raw) || raw.v !== 1) return null
  if (typeof raw.id !== 'string' || !UUID_RE.test(raw.id)) return null
  if (raw.mode !== 'code' && raw.mode !== 'chat') return null
  if (typeof raw.createdAt !== 'number' || !Array.isArray(raw.columns) || raw.columns.length < 1 || raw.columns.length > 4) return null
  const cwd = raw.cwd === null || raw.cwd === undefined ? null : raw.cwd
  if (cwd !== null && (typeof cwd !== 'string' || !isAbsolute(cwd))) return null
  if (raw.mode === 'code' && cwd === null) return null
  const columns: CompareColumnManifest[] = []
  for (const c of raw.columns) {
    const col = parseColumn(c, raw.mode)
    if (!col) return null
    columns.push(col)
  }
  if (new Set(columns.map((c) => c.index)).size !== columns.length) return null
  return {
    v: 1,
    id: raw.id,
    mode: raw.mode,
    cwd,
    baseCommit: optStr(raw.baseCommit),
    dirtyAtStart: raw.dirtyAtStart === true,
    createdAt: raw.createdAt,
    promptPreview: typeof raw.promptPreview === 'string' ? raw.promptPreview.slice(0, 200) : '',
    permissionMode:
      typeof raw.permissionMode === 'string' && PERMS.includes(raw.permissionMode)
        ? (raw.permissionMode as CompareManifest['permissionMode'])
        : 'manual',
    pausedProviders: Array.isArray(raw.pausedProviders) ? raw.pausedProviders.filter((x): x is string => typeof x === 'string') : [],
    columns
  }
}

export class ManifestStore {
  constructor(
    readonly dir: string,
    private readonly log: (msg: string, err?: unknown) => void = (msg, err) => console.warn(msg, err)
  ) {}

  private fileOf(id: string): string {
    if (!UUID_RE.test(id)) throw new Error(`id de comparación inválido: ${id}`)
    return join(this.dir, `${id.toLowerCase()}.json`)
  }

  write(m: CompareManifest): void {
    const file = this.fileOf(m.id)
    mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify(m), { mode: 0o600 })
      renameSync(tmp, file)
      chmodSync(file, 0o600)
    } catch (err) {
      rmSync(tmp, { force: true })
      throw err
    }
  }

  read(id: string): CompareManifest | null {
    const file = this.fileOf(id)
    if (!existsSync(file)) return null
    try {
      return parseManifest(JSON.parse(readFileSync(file, 'utf8')))
    } catch (err) {
      this.log(`[compare] manifiesto corrupto ignorado: ${file}`, err)
      return null
    }
  }

  list(): CompareManifest[] {
    if (!existsSync(this.dir)) return []
    const out: CompareManifest[] = []
    for (const name of readdirSync(this.dir)) {
      const id = /^([0-9a-f-]{36})\.json$/i.exec(name)?.[1]
      if (!id || !UUID_RE.test(id)) continue
      const m = this.read(id)
      if (m && m.id.toLowerCase() === id.toLowerCase()) out.push(m)
      else if (!m) this.log(`[compare] manifiesto inválido ignorado: ${name}`)
    }
    return out.sort((a, b) => a.createdAt - b.createdAt)
  }

  remove(id: string): void {
    rmSync(this.fileOf(id), { force: true })
  }
}
