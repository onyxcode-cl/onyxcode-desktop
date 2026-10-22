/**
 * BackgroundShellManager: shell en segundo plano supervisado (`shell_bg`). Núcleo puro: todo lo del sistema entra por
 * `ManagerDeps` (procesos, archivos, reloj, temporizadores) y no importa Electron.
 *
 * Reglas (docs/DISENO-SEGUNDO-PLANO.md §3.2):
 *  - Cada trabajo corre en su propio grupo de procesos; parar/cerrar termina el grupo entero (SIGTERM y, tras la gracia, SIGKILL).
 *  - Sin plazo fijo: señales de vida = salida nueva, CPU del árbol (cambio de CPU acumulada o de membresía) y crecimiento de
 *    archivos observados. Si pasan `quietMs` sin ninguna, NO se mata: pasa a `possibly-stuck` y se emite un evento (y se repite
 *    cada `quietMs`) para que el modelo y la persona decidan. Cualquier señal lo devuelve a `running`. El tope absoluto
 *    `maxRuntimeMs` es opcional (por defecto ninguno) y ese sí corta.
 *  - Tope de concurrencia: el trabajo N+1 se RECHAZA con error claro; jamás se poda uno vivo.
 *  - Salida a un archivo por trabajo (carpeta 0700, archivos 0600), con recorte cabeza/cola y lectura incremental por offset.
 */
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { nodeFs, type ShellBgFs } from './fs-port'
import { OutputStore, utf8Safe } from './output-store'
import { createNodeProcessPort, type CpuSample, type ProcessPort, type SpawnedChild } from './process-port'
import { OWNER_DIR_PREFIX, PidRegistry, cleanupStaleRuns, type CleanupReport } from './registry'
import { LIVE_STATES, ShellBgError, type JobState, type JobStatus, type ReadResult, type ShellBgEvent, type StartOptions } from './types'
import { DEFAULT_MAX_COMMAND_LENGTH, buildChildEnv, validateCommand, validateCwd, validateWatchPaths } from './validate'

export const DEFAULTS = {
  maxConcurrent: 8,
  quietMs: 15 * 60_000,
  minQuietMs: 1000,
  headMaxBytes: 2 * 1024 * 1024,
  tailMaxBytes: 2 * 1024 * 1024,
  graceMs: 3000,
  tickMs: 5000,
  lastLines: 20,
  maxFinishedRetained: 32,
  readDefaultBytes: 16 * 1024,
  readMaxBytes: 64 * 1024,
  closeWaitMs: 1000
} as const

export interface Timer {
  cancel(): void
}

export interface ManagerDeps {
  fs: ShellBgFs
  port: ProcessPort
  now(): number
  /** Programa `fn` en `ms`. Los temporizadores reales deben ser `unref`. */
  schedule(fn: () => void, ms: number): Timer
  genId(): string
  ownerPid: number
  baseEnv: Record<string, string | undefined>
}

export interface ManagerOptions {
  /** Carpeta base privada para las salidas y el registro de PIDs (p. ej. `<tmp>/lazunox-shell-bg-<uid>`). */
  baseDir: string
  maxConcurrent?: number
  quietMs?: number
  /** Tope absoluto por defecto para todos los trabajos. Por defecto ninguno. */
  maxRuntimeMs?: number | null
  headMaxBytes?: number
  tailMaxBytes?: number
  graceMs?: number
  /** Periodo de la supervisión automática. `0` = sin temporizador (las pruebas llaman a `tick()`). */
  tickMs?: number
  lastLines?: number
  maxFinishedRetained?: number
  maxCommandLength?: number
  onEvent?: (e: ShellBgEvent) => void
  deps?: Partial<ManagerDeps>
}

interface Job {
  id: string
  command: string
  cwd: string
  pid: number
  child: SpawnedChild
  store: OutputStore
  state: JobState
  startedAt: number
  endedAt: number | null
  lastSignalAt: number
  quietMs: number
  maxRuntimeMs: number | null
  watch: Map<string, number>
  lastCpu: CpuSample | null
  stuckRepeat: number
  lastNotifyAt: number
  exitCode: number | null
  signal: string | null
  stopRequested: boolean
  limitHit: boolean
  terminating: boolean
  leaderExited: boolean
  groupMayLive: boolean
  finalized: boolean
  exited: Promise<void>
  resolveExited: () => void
}

function realDeps(): ManagerDeps {
  return {
    fs: nodeFs,
    port: createNodeProcessPort(),
    now: () => Date.now(),
    schedule: (fn, ms) => {
      const t = setTimeout(fn, ms)
      t.unref?.()
      return { cancel: () => clearTimeout(t) }
    },
    genId: () => `bg_${randomBytes(4).toString('hex')}`,
    ownerPid: process.pid,
    baseEnv: process.env
  }
}

export class BackgroundShellManager {
  private readonly o: Required<Omit<ManagerOptions, 'onEvent' | 'deps' | 'maxRuntimeMs'>> & {
    maxRuntimeMs: number | null
    onEvent?: (e: ShellBgEvent) => void
  }
  private readonly d: ManagerDeps
  private readonly jobs = new Map<string, Job>()
  private ownDir: string | null = null
  private registry: PidRegistry | null = null
  private tickTimer: Timer | null = null
  private ticking = false
  private shuttingDown = false
  private setupPromise: Promise<void> | null = null

  constructor(opts: ManagerOptions) {
    this.d = { ...realDeps(), ...opts.deps }
    this.o = {
      baseDir: opts.baseDir,
      maxConcurrent: opts.maxConcurrent ?? DEFAULTS.maxConcurrent,
      quietMs: opts.quietMs ?? DEFAULTS.quietMs,
      maxRuntimeMs: opts.maxRuntimeMs ?? null,
      headMaxBytes: opts.headMaxBytes ?? DEFAULTS.headMaxBytes,
      tailMaxBytes: opts.tailMaxBytes ?? DEFAULTS.tailMaxBytes,
      graceMs: opts.graceMs ?? DEFAULTS.graceMs,
      tickMs: opts.tickMs ?? DEFAULTS.tickMs,
      lastLines: opts.lastLines ?? DEFAULTS.lastLines,
      maxFinishedRetained: opts.maxFinishedRetained ?? DEFAULTS.maxFinishedRetained,
      maxCommandLength: opts.maxCommandLength ?? DEFAULT_MAX_COMMAND_LENGTH,
      onEvent: opts.onEvent
    }
  }

  /** Limpia restos de ejecuciones anteriores (PIDs verificados por identidad). Llamar una vez al arrancar. */
  async init(): Promise<CleanupReport> {
    return cleanupStaleRuns({
      fs: this.d.fs,
      port: this.d.port,
      baseDir: this.o.baseDir,
      ownDir: this.ownDir,
      graceMs: this.o.graceMs,
      sleep: (ms) => new Promise((r) => this.d.schedule(r, ms))
    })
  }

  // ── API ────────────────────────────────────────────────────────────────

  async start(command: string, opts: Partial<StartOptions> & { cwd: string }): Promise<string> {
    if (this.shuttingDown) throw new ShellBgError('SHUTTING_DOWN', 'The background shell is shutting down.')
    const cmd = validateCommand(command, this.o.maxCommandLength)
    const cwd = validateCwd(opts.cwd, this.d.fs)
    const env = buildChildEnv(this.d.baseEnv, opts.env)
    const watchPaths = validateWatchPaths(opts.watchPaths)
    const quietMs = this.checkMs('quietMs', opts.quietMs, DEFAULTS.minQuietMs) ?? this.o.quietMs
    const maxRuntimeMs = this.checkMs('maxRuntimeMs', opts.maxRuntimeMs, 1000) ?? this.o.maxRuntimeMs

    await this.ensureSetup()
    if (this.shuttingDown) throw new ShellBgError('SHUTTING_DOWN', 'The background shell is shutting down.')

    // Comprobación + alta sin ningún `await` en medio: dos `start` concurrentes no pueden colarse por encima del tope.
    const live = this.liveJobs()
    if (live.length >= this.o.maxConcurrent) {
      throw new ShellBgError(
        'TOO_MANY_JOBS',
        `Too many background jobs are running (${live.length}/${this.o.maxConcurrent}). ` +
          `Nothing was started and no running job was touched. Wait for one to finish (you will be notified) ` +
          `or stop one with bgshell_stop. Running: ${live.map((j) => j.id).join(', ')}.`
      )
    }

    const id = this.d.genId()
    const dir = this.ownDir as string
    const store = new OutputStore({
      fs: this.d.fs,
      headPath: join(dir, `${id}.log`),
      tailPath: join(dir, `${id}.tail.log`),
      headMax: this.o.headMaxBytes,
      tailMax: this.o.tailMaxBytes
    })
    let child: SpawnedChild
    try {
      child = this.d.port.spawn(cmd, { cwd, env })
    } catch (e) {
      store.close()
      throw new ShellBgError('SPAWN_FAILED', `Could not start the command: ${(e as Error).message}`)
    }
    child.onError(() => {
      /* el fallo de lanzamiento se maneja abajo por `pid === undefined`; un error posterior no debe tumbar el proceso */
    })
    if (child.pid === undefined) {
      store.close()
      throw new ShellBgError('SPAWN_FAILED', 'Could not start the command (the shell failed to launch).')
    }
    const now = this.d.now()
    let resolveExited!: () => void
    const exited = new Promise<void>((r) => (resolveExited = r))
    const job: Job = {
      id,
      command: cmd,
      cwd,
      pid: child.pid,
      child,
      store,
      state: 'running',
      startedAt: now,
      endedAt: null,
      lastSignalAt: now,
      quietMs,
      maxRuntimeMs,
      watch: new Map(watchPaths.map((p) => [p, this.d.fs.stat(p)?.size ?? -1])),
      lastCpu: null,
      stuckRepeat: 0,
      lastNotifyAt: 0,
      exitCode: null,
      signal: null,
      stopRequested: false,
      limitHit: false,
      terminating: false,
      leaderExited: false,
      groupMayLive: true,
      finalized: false,
      exited,
      resolveExited
    }
    this.jobs.set(id, job)
    child.onData((chunk) => {
      if (job.finalized) return
      job.store.append(chunk)
      this.markAlive(job)
    })
    child.onExit((code, signal) => this.onLeaderExit(job, code, signal))
    child.onClose(() => this.finalize(job))
    void this.recordIdentity(job)
    this.ensureTimer()
    return id
  }

  status(id: string): JobStatus {
    return this.toStatus(this.get(id))
  }

  list(): JobStatus[] {
    return [...this.jobs.values()].map((j) => this.toStatus(j))
  }

  read(id: string, opts: { fromByte?: number; maxBytes?: number } = {}): ReadResult {
    const job = this.get(id)
    const from = opts.fromByte ?? 0
    const max = opts.maxBytes ?? DEFAULTS.readDefaultBytes
    if (!Number.isInteger(from) || from < 0) throw new ShellBgError('INVALID_INPUT', 'fromByte must be an integer >= 0.')
    if (!Number.isInteger(max) || max < 1 || max > DEFAULTS.readMaxBytes) {
      throw new ShellBgError('INVALID_INPUT', `maxBytes must be an integer between 1 and ${DEFAULTS.readMaxBytes}.`)
    }
    const r = job.store.read(from, max)
    const { text, used } = utf8Safe(r.data)
    const marker = r.gapSkipped ? `[... ${r.omittedBytes} bytes omitted by the size limit ...]\n` : ''
    return {
      id,
      fromByte: from,
      nextByte: r.nextByte - (r.data.length - used),
      totalBytes: job.store.total,
      omittedBytes: r.omittedBytes,
      gapSkipped: r.gapSkipped,
      state: job.state,
      text: marker + text
    }
  }

  /** Termina el trabajo (grupo entero) y devuelve su estado final. Idempotente. */
  async stop(id: string): Promise<JobStatus> {
    const job = this.get(id)
    if (this.isLive(job)) {
      job.stopRequested = true
      await this.terminate(job)
    }
    return this.toStatus(job)
  }

  /**
   * Una vuelta de supervisión (la llama el temporizador; las pruebas la llaman a mano con reloj falso).
   * No mata nada salvo por el tope absoluto opcional.
   */
  async tick(): Promise<void> {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const job of this.liveJobs()) {
        if (!this.isLive(job)) continue
        const now = this.d.now()
        if (job.maxRuntimeMs !== null && now - job.startedAt >= job.maxRuntimeMs) {
          job.limitHit = true
          void this.terminate(job)
          continue
        }
        await this.sampleSignals(job)
        if (!this.isLive(job)) continue
        job.store.flushTail()
        this.checkQuiet(job)
      }
    } finally {
      this.ticking = false
    }
  }

  /** Cierre garantizado: SIGTERM a todos los grupos, SIGKILL tras la gracia, y borra las salidas. */
  async shutdown(): Promise<void> {
    this.shuttingDown = true
    this.tickTimer?.cancel()
    this.tickTimer = null
    const all = [...this.jobs.values()]
    for (const j of all) if (j.groupMayLive) this.d.port.killGroup(j.pid, 'SIGTERM')
    await this.waitUntil(() => all.every((j) => j.finalized && !this.groupLive(j)), this.o.graceMs)
    for (const j of all) if (this.groupLive(j)) this.d.port.killGroup(j.pid, 'SIGKILL')
    await this.waitUntil(() => all.every((j) => j.finalized && !this.groupLive(j)), 1500)
    for (const j of all) {
      j.stopRequested = true
      this.finalize(j, true)
      j.store.close()
    }
    if (this.ownDir) {
      try {
        this.d.fs.rmrf(this.ownDir)
      } catch {
        /* queda para la limpieza del próximo arranque */
      }
    }
    this.jobs.clear()
  }

  /** Último recurso síncrono (manejador de `exit` del proceso): SIGKILL a todo grupo que pueda seguir vivo. */
  killAllSync(): void {
    for (const j of this.jobs.values()) if (j.groupMayLive) this.d.port.killGroup(j.pid, 'SIGKILL')
  }

  // ── Internos ───────────────────────────────────────────────────────────

  private checkMs(name: string, v: number | undefined | null, min: number): number | null {
    if (v === undefined || v === null) return null
    if (!Number.isFinite(v) || v < min || v > 7 * 24 * 3600_000) {
      throw new ShellBgError('INVALID_INPUT', `${name} must be a number of milliseconds between ${min} and 604800000.`)
    }
    return v
  }

  private ensureSetup(): Promise<void> {
    this.setupPromise ??= (async () => {
      this.ownDir = this.d.fs.mkdtemp(this.o.baseDir, OWNER_DIR_PREFIX)
      const identity = await this.d.port.identity(this.d.ownerPid)
      this.registry = new PidRegistry(this.d.fs, this.ownDir, { pid: this.d.ownerPid, identity })
      this.registry.write()
    })().catch((e) => {
      this.setupPromise = null
      throw e
    })
    return this.setupPromise
  }

  private async recordIdentity(job: Job): Promise<void> {
    const identity = await this.d.port.identity(job.pid)
    if (!job.finalized) this.registry?.upsert({ id: job.id, pid: job.pid, identity })
  }

  private ensureTimer(): void {
    if (this.o.tickMs <= 0 || this.tickTimer || this.shuttingDown) return
    const loop = (): void => {
      this.tickTimer = null
      void this.tick().finally(() => {
        if (this.liveJobs().length > 0 && !this.shuttingDown) this.tickTimer = this.d.schedule(loop, this.o.tickMs)
      })
    }
    this.tickTimer = this.d.schedule(loop, this.o.tickMs)
  }

  private get(id: string): Job {
    const job = this.jobs.get(id)
    if (!job) throw new ShellBgError('NOT_FOUND', `Unknown job id "${id}". Use bgshell_list to see the known jobs.`)
    return job
  }

  private isLive(job: Job): boolean {
    return LIVE_STATES.includes(job.state)
  }

  private liveJobs(): Job[] {
    return [...this.jobs.values()].filter((j) => this.isLive(j))
  }

  private groupLive(job: Job): boolean {
    return job.groupMayLive && this.d.port.groupAlive(job.pid)
  }

  private emit(e: ShellBgEvent): void {
    try {
      this.o.onEvent?.(e)
    } catch {
      /* un oyente defectuoso no puede romper la supervisión */
    }
  }

  private markAlive(job: Job): void {
    job.lastSignalAt = this.d.now()
    if (job.state === 'possibly-stuck') {
      job.state = 'running'
      job.stuckRepeat = 0
      this.emit({ type: 'resumed', id: job.id, command: job.command })
    }
  }

  private async sampleSignals(job: Job): Promise<void> {
    let alive = false
    const sample = await this.d.port.sampleCpu(job.pid).catch(() => null)
    if (sample && this.isLive(job)) {
      const prev = job.lastCpu
      if (prev && (sample.cpuSeconds > prev.cpuSeconds + 0.005 || sample.pids.join(',') !== prev.pids.join(','))) alive = true
      job.lastCpu = sample
    }
    for (const [path, before] of job.watch) {
      const size = this.d.fs.stat(path)?.size ?? -1
      if (size > before) alive = true
      job.watch.set(path, size)
    }
    if (alive && this.isLive(job)) this.markAlive(job)
  }

  private checkQuiet(job: Job): void {
    const now = this.d.now()
    const idle = now - job.lastSignalAt
    if (job.state === 'running' && idle >= job.quietMs) {
      job.state = 'possibly-stuck'
      job.stuckRepeat = 1
      job.lastNotifyAt = now
      this.emitStuck(job, idle)
    } else if (job.state === 'possibly-stuck' && now - job.lastNotifyAt >= job.quietMs) {
      job.stuckRepeat += 1
      job.lastNotifyAt = now
      this.emitStuck(job, idle)
    }
  }

  private emitStuck(job: Job, idleMs: number): void {
    this.emit({
      type: 'possibly-stuck',
      id: job.id,
      command: job.command,
      idleMs,
      quietMs: job.quietMs,
      repeat: job.stuckRepeat,
      lastLines: job.store.lastLines(this.o.lastLines)
    })
  }

  /** SIGTERM al grupo y SIGKILL tras la gracia si el líder sigue; resuelve cuando el trabajo quedó finalizado. */
  private terminate(job: Job): Promise<void> {
    if (!job.terminating) {
      job.terminating = true
      this.d.port.killGroup(job.pid, 'SIGTERM')
      const t = this.d.schedule(() => {
        if (!job.finalized && this.d.port.groupAlive(job.pid)) this.d.port.killGroup(job.pid, 'SIGKILL')
      }, this.o.graceMs)
      void job.exited.then(() => t.cancel())
    }
    return job.exited
  }

  private onLeaderExit(job: Job, code: number | null, signal: string | null): void {
    job.leaderExited = true
    job.exitCode = code
    job.signal = signal
    job.endedAt = this.d.now()
    job.state = job.stopRequested ? 'stopped' : job.limitHit ? 'killed-limit' : 'exited'
    // Nietos que sobrevivan al líder: se terminan con el grupo (nada queda huérfano).
    if (this.d.port.groupAlive(job.pid)) {
      this.d.port.killGroup(job.pid, 'SIGTERM')
      this.d.schedule(() => {
        if (this.d.port.groupAlive(job.pid)) this.d.port.killGroup(job.pid, 'SIGKILL')
        job.groupMayLive = false
      }, this.o.graceMs)
    } else {
      job.groupMayLive = false
    }
    // Se espera al cierre de los pipes (para no perder el final de la salida), con un tope por si un nieto los retiene.
    this.d.schedule(() => this.finalize(job), DEFAULTS.closeWaitMs)
  }

  private finalize(job: Job, force = false): void {
    if (job.finalized) return
    if (!job.leaderExited && !force) return
    job.finalized = true
    if (job.endedAt === null) job.endedAt = this.d.now()
    job.store.flushTail()
    this.registry?.remove(job.id)
    if (job.state === 'running' || job.state === 'possibly-stuck') job.state = job.stopRequested ? 'stopped' : 'exited'
    this.emit({
      type: 'exit',
      id: job.id,
      command: job.command,
      state: job.state as 'exited' | 'stopped' | 'killed-limit',
      exitCode: job.exitCode,
      signal: job.signal,
      durationMs: job.endedAt - job.startedAt,
      lastLines: job.store.lastLines(this.o.lastLines)
    })
    job.resolveExited()
    this.pruneFinished()
  }

  private pruneFinished(): void {
    const done = [...this.jobs.values()].filter((j) => j.finalized).sort((a, b) => (a.endedAt ?? 0) - (b.endedAt ?? 0))
    while (done.length > this.o.maxFinishedRetained) {
      const old = done.shift() as Job
      old.store.close()
      for (const p of [old.store.path, old.store.path.replace(/\.log$/, '.tail.log')]) {
        try {
          this.d.fs.rmrf(p)
        } catch {
          /* se borra con la carpeta al cerrar */
        }
      }
      this.jobs.delete(old.id)
    }
  }

  private async waitUntil(pred: () => boolean, maxMs: number): Promise<void> {
    // Se cuenta el tiempo esperado (no `now()`): con un reloj falso que no avanza, el cierre igualmente termina.
    for (let waited = 0; !pred() && waited < maxMs; waited += 25) {
      await new Promise<void>((r) => this.d.schedule(r, 25))
    }
  }

  private toStatus(job: Job): JobStatus {
    const now = this.d.now()
    const end = job.endedAt ?? now
    return {
      id: job.id,
      state: job.state,
      command: job.command,
      cwd: job.cwd,
      pid: job.pid,
      startedAt: job.startedAt,
      endedAt: job.endedAt,
      durationMs: end - job.startedAt,
      idleMs: this.isLive(job) ? now - job.lastSignalAt : 0,
      quietMs: job.quietMs,
      maxRuntimeMs: job.maxRuntimeMs,
      exitCode: job.exitCode,
      signal: job.signal,
      totalBytes: job.store.total,
      omittedBytes: job.store.omittedBytes,
      outputFile: job.store.path,
      lastLines: job.store.lastLines(5, 1000)
    }
  }
}
