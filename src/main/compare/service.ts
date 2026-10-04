/**
 * «Comparar modelos»: orquestación en main. Crea una copia (worktree) por modelo desde `HEAD`, lanza una sesión por modelo
 * con el motor principal (escalonado y con tope por proveedor), clasifica la cuota («token rate limit») con UN reintento,
 * mide cada columna, cancela con `session.abort` esperando la parada, y adopta/descarta/cierra. El renderer solo pasa
 * `{ id, index }`: las rutas y las ramas las decide y guarda main. No importa `electron`.
 */
import { arch as osArch, cpus, platform as osPlatform, totalmem } from 'node:os'
import { existsSync } from 'node:fs'
import { redactSecrets, friendlyError } from '@shared/ai-errors'
import { t } from '@shared/i18n'
import { CHAT_AGENT } from '@shared/types'
import {
  COMPARE_MODELS_MAX,
  COMPARE_MODELS_MIN,
  type CompareAdoptResult,
  type CompareCloseResult,
  type CompareColumnManifest,
  type CompareDiffResult,
  type CompareManifest,
  type ComparePreflight,
  type CompareStartRequest
} from '@shared/ipc-code'
import { buildBenchBatch, type BenchColumnExtra, type BenchEnv } from './bench-export'
import { effectivePermissionMode, rulesetFor, type CompareEngine, type EngineMessage, type EngineStatus } from './engine'
import * as cgit from './git'
import { COMPARE_LIMITS, type CompareLimits } from './limits'
import { ManifestStore, UUID_RE } from './manifest'
import { computeMetrics, emptyMetrics } from './metrics'
import { engineRetryExceeded, errorText, isQuotaError, retryDelayMs } from './rate-limit'
import { pickNextStart } from './scheduler'

export class CompareError extends Error {
  constructor(
    message: string,
    readonly code: 'busy' | 'not-found' | 'invalid' | 'unconfirmed' | 'not-ready' = 'invalid'
  ) {
    super(message)
    this.name = 'CompareError'
  }
}

export interface CompareServiceDeps {
  store: ManifestStore
  engine: () => Promise<CompareEngine>
  /** Carpeta del modo Chat (las sesiones de comparación de Chat viven ahí). */
  chatDirectory: string
  onChange: (m: CompareManifest) => void
  limits?: Partial<CompareLimits>
  now?: () => number
  random?: () => number
  cliVersion?: () => string | null
  log?: (msg: string, err?: unknown) => void
}

interface ColRt {
  holdsSlot: boolean
  cancelRequested: boolean
  sentAt: number
  busySeen: boolean
  retryTimer: ReturnType<typeof setTimeout> | null
  pollFailures: number
}

interface Run {
  m: CompareManifest
  /** Texto completo del prompt: solo en memoria (tras recuperar no existe). */
  prompt: string | null
  rt: Map<number, ColRt>
  lastStartAt: number
  wake: ReturnType<typeof setTimeout> | null
  poller: ReturnType<typeof setTimeout> | null
  ticking: boolean
  lock: Promise<unknown>
  lastPersist: number
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

const isFinalState = (c: CompareColumnManifest): boolean =>
  c.discarded || c.state === 'done' || c.state === 'error' || c.state === 'cancelled' || (c.state === 'rateLimited' && c.retryAt === null)

type StatusMap = Record<string, EngineStatus>

export class CompareService {
  private readonly runs = new Map<string, Run>()
  private readonly limits: CompareLimits
  private recovered: Promise<void> | null = null

  constructor(private readonly deps: CompareServiceDeps) {
    this.limits = { ...COMPARE_LIMITS, ...(deps.limits ?? {}) } as CompareLimits
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private log(msg: string, err?: unknown): void {
    ;(this.deps.log ?? ((m: string, e?: unknown) => console.warn(m, e)))(msg, err)
  }

  // ───────────────────────── consulta ─────────────────────────

  async list(): Promise<CompareManifest[]> {
    await this.recover()
    return [...this.runs.values()].map((r) => clone(r.m)).sort((a, b) => a.createdAt - b.createdAt)
  }

  /** ¿Es un repositorio, cuál es su HEAD y está limpio? (para el diálogo previo). */
  async preflight(cwd: string): Promise<ComparePreflight> {
    const info = await cgit.repoInfo(cwd)
    if (!info) return { repo: false, root: null, head: null, shortHead: null, clean: true, dirtyFiles: 0 }
    return {
      repo: true,
      root: info.root,
      head: info.head,
      shortHead: info.head ? info.head.slice(0, 7) : null,
      clean: info.dirtyFiles === 0,
      dirtyFiles: info.dirtyFiles
    }
  }

  // ───────────────────────── recuperación ─────────────────────────

  /**
   * Al arrancar: carga los manifiestos, marca como interrumpidas las columnas que estaban en curso (el motor murió con
   * la app) y hace `git worktree prune` en sus repositorios. NO borra nada: las copias pueden tener trabajo.
   */
  recover(): Promise<void> {
    if (!this.recovered) {
      this.recovered = (async () => {
        const roots = new Set<string>()
        for (const m of this.deps.store.list()) {
          if (this.runs.has(m.id)) continue
          let changed = false
          for (const c of m.columns) {
            if (
              c.state === 'queued' ||
              c.state === 'starting' ||
              c.state === 'running' ||
              (c.state === 'rateLimited' && c.retryAt !== null)
            ) {
              c.interrupted = c.state !== 'queued'
              c.state = 'cancelled'
              c.retryAt = null
              c.finishedAt ??= this.now()
              changed = true
            }
          }
          if (changed) this.deps.store.write(m)
          if (m.cwd) roots.add(m.cwd)
          this.runs.set(m.id, this.newRun(m, null))
        }
        for (const root of roots) {
          try {
            if (existsSync(root)) await cgit.pruneWorktrees(root)
          } catch (err) {
            this.log(`[compare] git worktree prune falló en ${root}`, err)
          }
        }
      })()
    }
    return this.recovered
  }

  // ───────────────────────── crear ─────────────────────────

  async start(req: CompareStartRequest): Promise<CompareManifest> {
    await this.recover()
    if (!UUID_RE.test(req.id)) throw new CompareError(t('merr.compare.badId'))
    const id = req.id.toLowerCase()
    if (this.runs.has(id)) throw new CompareError(t('merr.compare.exists'))
    if ([...this.runs.values()].some((r) => this.isActive(r))) throw new CompareError(t('merr.compare.busy'), 'busy')
    const n = req.models.length
    if (n < COMPARE_MODELS_MIN || n > Math.min(COMPARE_MODELS_MAX, this.limits.maxColumns))
      throw new CompareError(t('merr.compare.badModels'))
    const keys = new Set(req.models.map((x) => `${x.providerID}/${x.modelID}/${x.variant ?? ''}`))
    if (keys.size !== n) throw new CompareError(t('merr.compare.badModels'))
    if (!req.prompt.trim()) throw new CompareError(t('merr.compare.emptyPrompt'))

    const id8 = id.replace(/-/g, '').slice(0, 8)
    let root: string | null = null
    let baseCommit: string | null = null
    let dirty = false
    const created: { path: string; branch: string }[] = []
    const columns: CompareColumnManifest[] = req.models.map((model, index) => ({
      index,
      model: { providerID: model.providerID, modelID: model.modelID, ...(model.variant ? { variant: model.variant } : {}) },
      sessionID: null,
      worktree: null,
      state: 'queued',
      adopted: false,
      discarded: false,
      startedAt: null,
      finishedAt: null,
      metrics: emptyMetrics(),
      error: null,
      retryAt: null,
      retried: false,
      stopUnconfirmed: false,
      interrupted: false,
      diff: null
    }))

    if (req.mode === 'code') {
      if (!req.cwd) throw new CompareError(t('merr.compare.needCwd'))
      const info = await cgit.repoInfo(req.cwd)
      if (!info) throw new CompareError(t('merr.compare.noRepo'))
      if (!info.head) throw new CompareError(t('merr.compare.noCommit'))
      root = info.root
      baseCommit = info.head
      dirty = info.dirtyFiles > 0
      try {
        for (const c of columns) {
          const path = cgit.worktreePathFor(root, id8, c.index)
          const branch = cgit.branchFor(id8, c.index)
          await cgit.createCompareWorktree(root, path, branch, baseCommit)
          created.push({ path, branch })
          c.worktree = { path, branch }
        }
      } catch (err) {
        for (const w of created.reverse())
          await cgit.removeCompareWorktree(root, w.path, w.branch).catch((e) => this.log('[compare] deshacer copia', e))
        throw err
      }
    }

    const m: CompareManifest = {
      v: 1,
      id,
      mode: req.mode,
      cwd: root,
      baseCommit,
      dirtyAtStart: dirty,
      createdAt: this.now(),
      promptPreview: redactSecrets(req.prompt.replace(/\s+/g, ' ').trim()).slice(0, 200),
      permissionMode: effectivePermissionMode(req.permissionMode),
      pausedProviders: [],
      columns
    }
    try {
      this.deps.store.write(m)
    } catch (err) {
      if (root) for (const w of created.reverse()) await cgit.removeCompareWorktree(root, w.path, w.branch).catch(() => undefined)
      throw err
    }
    const run = this.newRun(m, req.prompt)
    this.runs.set(m.id, run)
    this.emit(run, true)
    this.pump(run)
    return clone(m)
  }

  // ───────────────────────── cancelar / reintentar ─────────────────────────

  /** `index` ausente = todas las columnas, en paralelo. */
  async cancel(id: string, index?: number): Promise<void> {
    const run = this.runOf(id)
    const cols = index === undefined ? [...run.m.columns] : [this.colOf(run, index)]
    await Promise.all(cols.map((c) => this.cancelColumn(run, c)))
  }

  private async cancelColumn(run: Run, c: CompareColumnManifest): Promise<void> {
    const r = this.rtOf(run, c)
    if (c.discarded) return
    if (c.state === 'queued') {
      this.finishColumn(run, c, r, 'cancelled')
      return
    }
    const waiting = c.state === 'rateLimited' && c.retryAt !== null
    if (c.state !== 'starting' && c.state !== 'running' && !waiting) return
    r.cancelRequested = true
    if (r.retryTimer) clearTimeout(r.retryTimer)
    r.retryTimer = null
    const sessionID = c.sessionID
    const dir = this.dirOf(run, c)
    // Sin sesión todavía (la creación sigue en curso): no hay nada que parar; `launch` lo verá al volver.
    if (!sessionID) {
      this.finishColumn(run, c, r, 'cancelled')
      return
    }
    let idle = false
    try {
      const engine = await this.deps.engine()
      await engine.abort({ sessionID, directory: dir }).catch((e) => this.log('[compare] session.abort', e))
      idle = await this.waitIdle(engine, sessionID, dir)
      await this.refreshMetrics(run, c, engine).catch(() => undefined)
    } catch (err) {
      this.log('[compare] cancelar', err)
    }
    c.stopUnconfirmed = !idle
    this.finishColumn(run, c, r, 'cancelled')
  }

  private async waitIdle(engine: CompareEngine, sessionID: string, dir: string): Promise<boolean> {
    const deadline = this.now() + this.limits.abortIdleWaitMs
    for (;;) {
      try {
        const st = (await engine.statuses(dir))[sessionID]
        if (!st || st.type === 'idle') return true
      } catch {
        // el motor no responde: se sigue esperando hasta el límite
      }
      if (this.now() >= deadline) return false
      await sleep(this.limits.abortPollMs)
    }
  }

  /** «Reintentar» tras un límite de uso agotado o un error: reanuda el proveedor y re-envía el prompt a la MISMA sesión. */
  async retry(id: string, index: number): Promise<void> {
    const run = this.runOf(id)
    const c = this.colOf(run, index)
    const ok = (c.state === 'rateLimited' && c.retryAt === null) || c.state === 'error'
    if (c.discarded || !ok) throw new CompareError(t('merr.compare.notRetryable'), 'not-ready')
    if (run.prompt === null) throw new CompareError(t('merr.compare.noPrompt'), 'not-ready')
    const r = this.rtOf(run, c)
    r.cancelRequested = false
    r.pollFailures = 0
    c.error = null
    c.retried = false
    c.finishedAt = null
    c.retryAt = null
    c.state = 'queued'
    run.m.pausedProviders = run.m.pausedProviders.filter((p) => p !== c.model.providerID)
    this.emit(run, true)
    this.pump(run)
  }

  // ───────────────────────── planificador ─────────────────────────

  /** Hay columnas en curso o con arranque pendiente (una cola en pausa por cuota no cuenta). */
  private isActive(run: Run): boolean {
    return run.m.columns.some((c) => {
      if (c.discarded) return false
      if (c.state === 'starting' || c.state === 'running') return true
      if (c.state === 'rateLimited') return c.retryAt !== null
      return c.state === 'queued' && !run.m.pausedProviders.includes(c.model.providerID)
    })
  }

  private pump(run: Run): void {
    if (run.wake) clearTimeout(run.wake)
    run.wake = null
    for (let guard = 0; guard < 8; guard++) {
      const dec = pickNextStart({
        columns: run.m.columns.map((c) => ({
          index: c.index,
          providerID: c.model.providerID,
          state: c.state,
          holdsSlot: this.rtOf(run, c).holdsSlot
        })),
        now: this.now(),
        lastStartAt: run.lastStartAt,
        paused: new Set(run.m.pausedProviders),
        limits: this.limits
      })
      if (dec.start !== null) {
        const c = this.colOf(run, dec.start)
        const r = this.rtOf(run, c)
        run.lastStartAt = this.now()
        r.holdsSlot = true
        r.cancelRequested = false
        c.state = 'starting'
        c.finishedAt = null
        this.emit(run, true)
        void this.launch(run, c, r)
        continue
      }
      if (dec.wakeAt !== null) run.wake = setTimeout(() => this.pump(run), Math.max(0, dec.wakeAt - this.now()))
      break
    }
  }

  private async launch(run: Run, c: CompareColumnManifest, r: ColRt): Promise<void> {
    try {
      const engine = await this.deps.engine()
      if (r.cancelRequested) return
      const dir = this.dirOf(run, c)
      if (!c.sessionID) {
        const title = `⟂ ${c.model.modelID}${c.model.variant ? ` (${c.model.variant})` : ''}`
        const sessionID = await engine.createSession({
          directory: dir,
          title,
          agent: run.m.mode === 'code' ? 'build' : CHAT_AGENT,
          metadata: { mode: run.m.mode, compare: run.m.id },
          ...(run.m.mode === 'code' ? { permission: rulesetFor(run.m.permissionMode) } : {})
        })
        c.sessionID = sessionID
        this.emit(run, true)
        if (r.cancelRequested) return
      }
      await this.sendPrompt(run, c, r, engine)
    } catch (err) {
      await this.handleFailure(run, c, r, err)
    }
  }

  private async sendPrompt(run: Run, c: CompareColumnManifest, r: ColRt, engine: CompareEngine): Promise<void> {
    if (r.cancelRequested || !c.sessionID || run.prompt === null) return
    const dir = this.dirOf(run, c)
    c.state = 'running'
    c.startedAt = this.now()
    c.finishedAt = null
    c.error = null
    r.sentAt = c.startedAt
    r.busySeen = false
    r.pollFailures = 0
    this.emit(run, true)
    await engine.prompt({
      sessionID: c.sessionID,
      directory: dir,
      agent: run.m.mode === 'code' ? 'build' : CHAT_AGENT,
      model: { providerID: c.model.providerID, modelID: c.model.modelID },
      ...(c.model.variant ? { variant: c.model.variant } : {}),
      text: run.prompt
    })
    // Cancelado mientras el motor aceptaba el prompt: se vuelve a abortar.
    if (r.cancelRequested) await engine.abort({ sessionID: c.sessionID, directory: dir }).catch(() => undefined)
    this.ensurePolling(run)
  }

  // ───────────────────────── sondeo ─────────────────────────

  private ensurePolling(run: Run): void {
    if (run.poller) return
    run.poller = setTimeout(() => void this.tick(run), this.limits.pollMs)
  }

  private async tick(run: Run): Promise<void> {
    run.poller = null
    if (run.ticking) return
    run.ticking = true
    try {
      const running = run.m.columns.filter((c) => c.state === 'running' && c.sessionID && !this.rtOf(run, c).cancelRequested)
      if (running.length) {
        const engine = await this.deps.engine().catch(() => null)
        const cache = new Map<string, StatusMap>()
        for (const c of running) {
          const r = this.rtOf(run, c)
          if (!engine) {
            this.pollFailed(run, c, r, new Error(t('merr.compare.noEngine')))
            continue
          }
          try {
            await this.pollColumn(run, c, r, engine, cache)
            r.pollFailures = 0
          } catch (err) {
            this.pollFailed(run, c, r, err)
          }
        }
      }
    } finally {
      run.ticking = false
      if (run.m.columns.some((c) => c.state === 'running' || c.state === 'starting')) this.ensurePolling(run)
    }
  }

  private pollFailed(run: Run, c: CompareColumnManifest, r: ColRt, err: unknown): void {
    r.pollFailures++
    this.log('[compare] sondeo', err)
    if (r.pollFailures >= this.limits.maxPollFailures && c.state === 'running') {
      c.error = { kind: 'network', message: t('merr.compare.lost') }
      this.finishColumn(run, c, r, 'error')
    }
  }

  private async refreshMetrics(run: Run, c: CompareColumnManifest, engine: CompareEngine): Promise<EngineMessage[]> {
    const dir = this.dirOf(run, c)
    const sessionID = c.sessionID as string
    const msgs = await engine.messages({ sessionID, directory: dir })
    const kids = await engine.children({ sessionID, directory: dir }).catch(() => [] as string[])
    const kidMsgs = await Promise.all(kids.map((k) => engine.messages({ sessionID: k, directory: dir }).catch(() => [] as EngineMessage[])))
    const next = computeMetrics([msgs, ...kidMsgs], c.startedAt)
    if (JSON.stringify(next) !== JSON.stringify(c.metrics)) {
      c.metrics = next
      this.emit(run, false)
    }
    return msgs
  }

  private async pollColumn(
    run: Run,
    c: CompareColumnManifest,
    r: ColRt,
    engine: CompareEngine,
    cache: Map<string, StatusMap>
  ): Promise<void> {
    const dir = this.dirOf(run, c)
    let statuses = cache.get(dir)
    if (!statuses) {
      statuses = await engine.statuses(dir)
      cache.set(dir, statuses)
    }
    const st: EngineStatus = statuses[c.sessionID as string] ?? { type: 'idle' }
    if (st.type !== 'idle') r.busySeen = true
    const msgs = await this.refreshMetrics(run, c, engine)
    if (c.state !== 'running' || r.cancelRequested) return

    if (engineRetryExceeded(st, this.limits.engineRetryAbortAfter)) {
      // El motor insiste en reintentar por cuota: se aborta la columna para no gastar más cupo.
      await engine.abort({ sessionID: c.sessionID as string, directory: dir }).catch(() => undefined)
      const message = st.type === 'retry' ? st.message : 'token rate limit'
      await this.handleFailure(run, c, r, { name: 'APIError', data: { message, statusCode: 429 } }, true)
      return
    }
    const attempt = msgs.filter((m) => m.info.role === 'assistant' && (m.info.time?.created ?? 0) >= r.sentAt - 5000)
    const last = attempt[attempt.length - 1]
    if (st.type !== 'idle') return
    if (last?.info.error) return this.handleFailure(run, c, r, last.info.error)
    if (last?.info.time?.completed) return this.finishDone(run, c, r)
    if (!r.busySeen && attempt.length === 0 && this.now() - r.sentAt > this.limits.noStartTimeoutMs) {
      c.error = { kind: 'unknown', message: t('merr.compare.noStart') }
      this.finishColumn(run, c, r, 'error')
    }
  }

  // ───────────────────────── resultados ─────────────────────────

  private async handleFailure(run: Run, c: CompareColumnManifest, r: ColRt, err: unknown, forceFinal = false): Promise<void> {
    if (r.cancelRequested || c.state === 'cancelled' || c.discarded) return
    const text = redactSecrets(errorText(err)).slice(0, 300)
    if (isQuotaError(err)) {
      c.error = { kind: 'quota', message: text }
      if (!c.retried && !forceFinal) {
        const delay = retryDelayMs(this.deps.random, this.limits.retryBaseMs, this.limits.retryJitterMs)
        c.state = 'rateLimited'
        c.retryAt = this.now() + delay
        r.retryTimer = setTimeout(() => void this.retryNow(run, c, r), delay)
        this.emit(run, true)
        return
      }
      if (!run.m.pausedProviders.includes(c.model.providerID)) run.m.pausedProviders.push(c.model.providerID)
      c.retryAt = null
      this.finishColumn(run, c, r, 'rateLimited')
      return
    }
    const raw = (err as { raw?: unknown } | null)?.raw ?? err
    c.error = { kind: friendlyError(raw).kind, message: text || friendlyError(raw).message }
    this.finishColumn(run, c, r, 'error')
  }

  /** El único reintento automático por cuota: mismo prompt, misma sesión. */
  private async retryNow(run: Run, c: CompareColumnManifest, r: ColRt): Promise<void> {
    r.retryTimer = null
    if (r.cancelRequested || c.state !== 'rateLimited' || c.retryAt === null) return
    c.retried = true
    c.retryAt = null
    c.state = 'starting'
    this.emit(run, true)
    try {
      const engine = await this.deps.engine()
      await this.sendPrompt(run, c, r, engine)
    } catch (err) {
      await this.handleFailure(run, c, r, err)
    }
  }

  private finishDone(run: Run, c: CompareColumnManifest, r: ColRt): void {
    this.finishColumn(run, c, r, 'done')
    if (run.m.mode === 'code')
      void this.locked(run, () => this.computeDiffStat(run, c)).catch((e) => this.log('[compare] resumen del diff', e))
  }

  private async computeDiffStat(run: Run, c: CompareColumnManifest): Promise<void> {
    if (!c.worktree || !run.m.cwd || !run.m.baseCommit || c.discarded) return
    const snap = await cgit.snapshotPatch(run.m.cwd, c.worktree.path, run.m.baseCommit)
    c.diff = { files: snap.files.length, additions: snap.additions, deletions: snap.deletions }
    this.emit(run, true)
  }

  private finishColumn(run: Run, c: CompareColumnManifest, r: ColRt, state: CompareColumnManifest['state']): void {
    c.state = state
    c.finishedAt = this.now()
    if (state !== 'rateLimited') c.retryAt = null
    r.holdsSlot = false
    if (r.retryTimer) clearTimeout(r.retryTimer)
    r.retryTimer = null
    this.emit(run, true)
    this.pump(run)
    if (!run.m.columns.some((x) => x.state === 'running' || x.state === 'starting') && run.poller) {
      clearTimeout(run.poller)
      run.poller = null
    }
  }

  // ───────────────────────── diff / adoptar / descartar / cerrar ─────────────────────────

  async diff(id: string, index: number): Promise<CompareDiffResult> {
    const run = this.runOf(id)
    const c = this.colOf(run, index)
    return this.locked(run, async () => {
      const { root, worktree, base } = this.codeColumn(run, c)
      const snap = await cgit.snapshotPatch(root, worktree, base)
      const max = this.limits.patchDisplayMax
      const truncated = snap.patch.length > max
      return {
        files: snap.files.length,
        additions: snap.additions,
        deletions: snap.deletions,
        patch: (truncated ? snap.patch.subarray(0, max) : snap.patch).toString('utf8'),
        truncated
      }
    })
  }

  /**
   * «Quedarme con este». Code: `git apply --check` y, solo si pasa, el parche ENTERO al árbol de trabajo (sin commit);
   * si no entra, no se toca nada. Chat: marca la columna como elegida.
   */
  async adopt(id: string, index: number, force = false): Promise<CompareAdoptResult> {
    const run = this.runOf(id)
    const c = this.colOf(run, index)
    return this.locked(run, async () => {
      const notReady: CompareAdoptResult = { ok: false, reason: 'not-ready', files: [] }
      if (c.state !== 'done' || c.discarded || run.m.columns.some((x) => x.adopted)) return notReady
      if (run.m.mode === 'chat') {
        c.adopted = true
        this.emit(run, true)
        return { ok: true, files: [] }
      }
      const { root, worktree, base } = this.codeColumn(run, c)
      if (c.sessionID) {
        try {
          const engine = await this.deps.engine()
          const st = (await engine.statuses(worktree))[c.sessionID]
          if (st && st.type !== 'idle') return notReady
        } catch {
          // sin respuesta del motor: el estado `done` ya lo confirmó el sondeo
        }
      }
      const snap = await cgit.snapshotPatch(root, worktree, base)
      if (snap.patch.length === 0) return { ok: false, reason: 'empty', files: [] }
      if (snap.hasSymlink) return { ok: false, reason: 'symlink', files: snap.files }
      const dirty = new Set(await cgit.dirtyPaths(root))
      const overlap = snap.files.filter((f) => dirty.has(f))
      if (overlap.length && !force) return { ok: false, reason: 'dirty-overlap', files: overlap }
      const check = await cgit.applyCheck(root, snap.patch)
      if (!check.ok) return { ok: false, reason: 'conflict', files: check.files.length ? check.files : snap.files }
      await cgit.applyPatch(root, snap.patch)
      c.adopted = true
      c.diff = { files: snap.files.length, additions: snap.additions, deletions: snap.deletions }
      this.emit(run, true)
      return { ok: true, files: snap.files }
    })
  }

  async discard(id: string, index: number): Promise<void> {
    const run = this.runOf(id)
    const c = this.colOf(run, index)
    await this.locked(run, () => this.discardInner(run, c))
  }

  private async discardInner(run: Run, c: CompareColumnManifest): Promise<void> {
    if (c.discarded) return
    const r = this.rtOf(run, c)
    if (c.state === 'starting' || c.state === 'running' || (c.state === 'rateLimited' && c.retryAt !== null)) {
      throw new CompareError(t('merr.compare.running'), 'busy')
    }
    const dir = this.dirOf(run, c)
    let engine: CompareEngine | null = null
    try {
      engine = await this.deps.engine()
    } catch {
      engine = null
    }
    // Parada sin confirmar: no se le quita la carpeta a un proceso que puede seguir vivo.
    if (c.stopUnconfirmed && c.sessionID) {
      let idle = false
      try {
        const st = engine ? (await engine.statuses(dir))[c.sessionID] : undefined
        idle = !!engine && (!st || st.type === 'idle')
      } catch {
        idle = false
      }
      if (!idle) throw new CompareError(t('merr.compare.unconfirmed'), 'unconfirmed')
      c.stopUnconfirmed = false
    }
    if (c.state === 'queued') c.state = 'cancelled'
    r.holdsSlot = false
    if (engine && c.sessionID) await engine.deleteSession({ sessionID: c.sessionID, directory: dir }).catch(() => undefined)
    if (c.worktree) {
      if (!run.m.cwd) throw new CompareError(t('merr.compare.unsafePath', { path: c.worktree.path }))
      await engine?.disposeInstance?.(c.worktree.path).catch(() => undefined)
      await cgit.removeCompareWorktree(run.m.cwd, c.worktree.path, c.worktree.branch)
    }
    c.worktree = null
    c.sessionID = null
    c.discarded = true
    this.emit(run, true)
  }

  /** Cancela lo que corre, descarta las columnas que quedan y borra el manifiesto. Si alguna no se puede, lo conserva. */
  async close(id: string): Promise<CompareCloseResult> {
    const run = this.runOf(id)
    await this.cancel(id)
    const kept: number[] = []
    await this.locked(run, async () => {
      for (const c of run.m.columns) {
        // En Chat la sesión elegida queda como conversación normal.
        if (run.m.mode === 'chat' && c.adopted) continue
        try {
          await this.discardInner(run, c)
        } catch (err) {
          this.log(`[compare] no se pudo descartar la columna ${c.index}`, err)
          kept.push(c.index)
        }
      }
    })
    if (kept.length) return { closed: false, kept }
    if (run.m.cwd) await cgit.pruneWorktrees(run.m.cwd).catch(() => undefined)
    this.stopRun(run)
    this.deps.store.remove(run.m.id)
    this.runs.delete(run.m.id)
    return { closed: true, kept: [] }
  }

  // ───────────────────────── exportación ─────────────────────────

  async buildBench(id: string): Promise<{ fileName: string; json: string }> {
    const run = this.runOf(id)
    if (!run.m.columns.every(isFinalState)) throw new CompareError(t('merr.compare.notFinished'), 'not-ready')
    const extras = new Map<number, BenchColumnExtra>()
    await this.locked(run, async () => {
      for (const c of run.m.columns) {
        if (c.discarded || !c.worktree || !run.m.cwd || !run.m.baseCommit) continue
        try {
          const snap = await cgit.snapshotPatch(run.m.cwd, c.worktree.path, run.m.baseCommit)
          extras.set(c.index, { patch: snap.patch.toString('utf8'), filesModified: snap.files })
        } catch (err) {
          this.log('[compare] parche para exportar', err)
        }
      }
    })
    const env: BenchEnv = {
      os: osPlatform(),
      arch: osArch(),
      nodeVersion: process.version,
      gitVersion: await cgit.gitVersion(),
      cliVersion: this.deps.cliVersion?.() ?? null,
      ncpu: Math.max(1, cpus().length),
      totalMemBytes: Math.max(1, totalmem())
    }
    const batch = buildBenchBatch({ manifest: run.m, prompt: run.prompt, env, extras, now: this.deps.now })
    return { fileName: `onyx-compare-${run.m.id.replace(/-/g, '').slice(0, 8)}.json`, json: JSON.stringify(batch, null, 2) }
  }

  /** Detiene los temporizadores de todas las comparaciones (cierre de la app). No borra nada. */
  dispose(): void {
    for (const run of this.runs.values()) this.stopRun(run)
  }

  // ───────────────────────── utilidades ─────────────────────────

  private newRun(m: CompareManifest, prompt: string | null): Run {
    return { m, prompt, rt: new Map(), lastStartAt: 0, wake: null, poller: null, ticking: false, lock: Promise.resolve(), lastPersist: 0 }
  }

  private stopRun(run: Run): void {
    if (run.wake) clearTimeout(run.wake)
    if (run.poller) clearTimeout(run.poller)
    run.wake = null
    run.poller = null
    for (const r of run.rt.values()) if (r.retryTimer) clearTimeout(r.retryTimer)
  }

  private runOf(id: string): Run {
    const run = typeof id === 'string' ? this.runs.get(id.toLowerCase()) : undefined
    if (!run) throw new CompareError(t('merr.compare.notFound'), 'not-found')
    return run
  }

  private colOf(run: Run, index: number): CompareColumnManifest {
    const c = run.m.columns.find((x) => x.index === index)
    if (!c) throw new CompareError(t('merr.compare.notFound'), 'not-found')
    return c
  }

  private rtOf(run: Run, c: CompareColumnManifest): ColRt {
    let r = run.rt.get(c.index)
    if (!r) {
      r = { holdsSlot: false, cancelRequested: false, sentAt: 0, busySeen: false, retryTimer: null, pollFailures: 0 }
      run.rt.set(c.index, r)
    }
    return r
  }

  private dirOf(run: Run, c: CompareColumnManifest): string {
    return run.m.mode === 'code' ? (c.worktree?.path ?? run.m.cwd ?? this.deps.chatDirectory) : this.deps.chatDirectory
  }

  private codeColumn(run: Run, c: CompareColumnManifest): { root: string; worktree: string; base: string } {
    if (run.m.mode !== 'code' || !run.m.cwd || !run.m.baseCommit || !c.worktree || c.discarded) {
      throw new CompareError(t('merr.compare.notReady'), 'not-ready')
    }
    return { root: run.m.cwd, worktree: c.worktree.path, base: run.m.baseCommit }
  }

  /** Serializa las operaciones que tocan el índice del worktree o el árbol del proyecto. */
  private locked<T>(run: Run, fn: () => Promise<T>): Promise<T> {
    const next = run.lock.then(fn, fn)
    run.lock = next.catch(() => undefined)
    return next
  }

  private emit(run: Run, structural: boolean): void {
    const now = this.now()
    if (structural || now - run.lastPersist >= this.limits.persistMetricsMs) {
      try {
        this.deps.store.write(run.m)
        run.lastPersist = now
      } catch (err) {
        this.log('[compare] no se pudo guardar el manifiesto', err)
      }
    }
    try {
      this.deps.onChange(clone(run.m))
    } catch (err) {
      this.log('[compare] onChange', err)
    }
  }
}
