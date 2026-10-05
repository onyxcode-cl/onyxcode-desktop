/**
 * Transporte de señalización del MODO VIAJE: un segundo ejemplar del servidor local (`LanSignalingServer` en modo `tunnel`, ligado a
 * 127.0.0.1 en un puerto aleatorio) publicado por un proceso `cloudflared` (túnel rápido, sin cuenta).
 *
 * `start()`: escucha → binario verificado (hash y firma, antes de CADA arranque) → `cloudflared` → URL + conexión registrada (≤ 30 s)
 * → fija el origen público (hasta entonces TODO es 503) → autocomprobación → listo. Si el proceso MUERE se relanza con espera
 * exponencial (2…60 s, máx. 6 seguidas): cada relanzamiento da una URL NUEVA (el origen cambia) y una `T` nueva, y se avisa con
 * `onRestart` para que el servicio revoque los vínculos del túnel anterior. `stop()` es idempotente y no deja procesos.
 */
import { TRAVEL_KEEPALIVE, TRAVEL_PROCESS, TUNNEL_ORIGIN_RE, type TravelError } from '@shared/remote/travel'
import type { AuditInput } from '../audit'
import { backoffDelayMs, canRestart } from '../tunnel/backoff'
import { BinaryError } from '../tunnel/binary'
import { CloudflaredProcess, TunnelStartError, type CloudflaredDeps, type StartErrorCode } from '../tunnel/cloudflared'
import { LanSignalingServer } from './lan-server'
import { runSelfCheck, realHttpGet, type HttpGet, type SelfCheckResult } from './tunnel-selfcheck'
import { ProbeNonces, TunnelGate } from './tunnel-gate'
import { TunnelLimits } from './tunnel-limits'
import type { SignalingPeer, SignalingStartOptions, SignalingTransport, TransportStatus } from './types'

/** Fase visible del modo viaje (Ajustes la traduce a `TravelStatus`). */
export type TunnelPhase = 'idle' | 'starting' | 'checking' | 'online' | 'connecting' | 'retrying' | 'failed'

export class TunnelStartFailure extends Error {
  constructor(readonly code: TravelError) {
    super(code)
  }
}

export interface TunnelTransportOptions {
  pwaDir: string
  /** Comprueba hash y firma del binario y devuelve su ruta (lanza `BinaryError`). Se llama antes de CADA arranque. */
  ensureBinary: () => Promise<string>
  /** `HOME` privado de `cloudflared`. */
  homeDir: string
  deps: CloudflaredDeps
  /** Política: `false` = no se abre ni el puerto ni el proceso. */
  allowed?: () => boolean
  audit?: (e: AuditInput) => void
  /** Autocomprobación (por defecto la real, por HTTPS). Las pruebas la sustituyen. */
  selfCheck?: (ctx: {
    origin: string
    token: string
    expected: (p: string) => Buffer | null
    issueNonce: () => string
  }) => Promise<SelfCheckResult>
  httpGet?: HttpGet
  /** Solo pruebas: ajustes de tiempos y observador de líneas del proceso. */
  startTimeoutMs?: number
  stopGraceMs?: number
  keepalive?: { pingMs: number; deadMs: number }
  rand?: () => number
  /** Solo pruebas: espera (ms) antes de relanzar (por defecto la espera exponencial de 2 a 60 s). */
  backoff?: (attempt: number, rate: boolean) => number
  onProcessLine?: (line: string) => void
  /** Reloj de la autocomprobación (pruebas). */
  selfCheckMaxMs?: number
}

export class TunnelSignalingTransport implements SignalingTransport {
  private server: LanSignalingServer | null = null
  private proc: CloudflaredProcess | null = null
  private readonly gate = new TunnelGate()
  private readonly limits = new TunnelLimits()
  private readonly probes = new ProbeNonces()
  private pub: string | null = null
  private ph: TunnelPhase = 'idle'
  private stopped = true
  private failures = 0
  private onlineSince = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private offlineTimer: ReturnType<typeof setTimeout> | null = null
  private offline = false
  private suspended = false
  private err: TravelError | null = null
  private peerCb: ((p: SignalingPeer) => void) | null = null
  private readonly statusCbs: Array<(s: TransportStatus) => void> = []
  private readonly restartCbs: Array<(origin: string) => void> = []
  private readonly failCbs: Array<(e: TravelError) => void> = []
  private launching: Promise<void> | null = null

  constructor(private readonly o: TunnelTransportOptions) {}

  // ── SignalingTransport ──

  onPeer(cb: (peer: SignalingPeer) => void): void {
    this.peerCb = cb
    this.server?.onPeer(cb)
  }

  onStatus(cb: (s: TransportStatus) => void): void {
    this.statusCbs.push(cb)
  }

  /** El túnel se relanzó con otro nombre (el origen cambió). */
  onRestart(cb: (origin: string) => void): void {
    this.restartCbs.push(cb)
  }

  /** Dejó de intentarlo (6 caídas seguidas): el servicio debe cortar. */
  onFail(cb: (e: TravelError) => void): void {
    this.failCbs.push(cb)
  }

  phase(): TunnelPhase {
    return this.ph
  }

  lastError(): TravelError | null {
    return this.err
  }

  /** `T` de la puerta: va en la ruta del QR (`/k/<T>`). `null` si el túnel no está abierto. */
  travelToken(): string | null {
    return this.pub && this.server ? this.gate.token : null
  }

  /** Origen público vigente (`null` mientras no haya túnel). */
  origin(): string | null {
    return this.pub
  }

  status(): TransportStatus {
    if (this.ph === 'failed' || this.offline) return 'offline'
    return this.ph === 'online' && !this.suspended && this.proc?.state() === 'online' ? 'online' : 'connecting'
  }

  async start(opts: SignalingStartOptions): Promise<{ origin: string }> {
    if (this.server) throw new Error('already-started')
    if (this.o.allowed && !this.o.allowed()) throw new TunnelStartFailure('no-binary')
    this.stopped = false
    this.failures = 0
    this.err = null
    const server = new LanSignalingServer({
      ip: '127.0.0.1',
      pwaDir: this.o.pwaDir,
      tunnel: {
        gate: this.gate,
        limits: this.limits,
        probes: this.probes,
        publicOrigin: () => this.pub,
        keepalive: this.o.keepalive ?? TRAVEL_KEEPALIVE,
        onGateReject: (n) => this.o.audit?.({ kind: 'travel-gate-reject', n: Math.min(n, 1000) })
      }
    })
    if (this.peerCb) server.onPeer(this.peerCb)
    this.server = server
    try {
      await server.start(opts)
      this.setPhase('starting')
      await this.launch(false)
    } catch (err) {
      await this.stop()
      throw err instanceof TunnelStartFailure ? err : new TunnelStartFailure('exited:1')
    }
    return { origin: this.pub as string }
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    if (this.offlineTimer) clearTimeout(this.offlineTimer)
    this.offlineTimer = null
    // Un arranque en curso (esperando la URL o la autocomprobación) se corta ya: parar el proceso hace que `start()` rechace.
    const early = this.proc?.stop().catch(() => undefined)
    try {
      await this.launching
    } catch {
      /* el fallo ya se informó a quien llamó a `start()` */
    }
    await early
    const proc = this.proc
    const server = this.server
    this.pub = null
    this.proc = null
    this.server = null
    this.ph = 'idle'
    this.offline = false
    await proc?.stop().catch(() => undefined)
    await server?.stop().catch(() => undefined)
  }

  /** Síncrono: SIGKILL al árbol del proceso (salir de la app). */
  killNow(): void {
    this.stopped = true
    this.proc?.killNow()
  }

  suspend(): void {
    this.suspended = true
    this.emit()
  }

  resume(): void {
    this.suspended = false
    this.emit()
    // Tras despertar, si el proceso no vuelve a registrarse en 60 s se marca `offline` (no se mata: puede volver).
    this.armOffline(60_000)
  }

  networkChanged(): void {
    /* `cloudflared` reconecta solo con las mismas credenciales: la URL se mantiene. */
  }

  recheck(): void {
    /* la política la aplica el servicio */
  }

  // ── lanzamiento ──

  private setPhase(p: TunnelPhase): void {
    if (this.ph === p) return
    this.ph = p
    this.emit()
  }

  private emit(): void {
    for (const cb of this.statusCbs) cb(this.status())
  }

  private armOffline(ms: number): void {
    if (this.offlineTimer) clearTimeout(this.offlineTimer)
    this.offlineTimer = setTimeout(() => {
      if (this.proc && this.proc.state() !== 'online' && !this.stopped) {
        this.offline = true
        this.emit()
      }
    }, ms)
    this.offlineTimer.unref?.()
  }

  private launch(isRestart: boolean): Promise<void> {
    this.launching = this.doLaunch(isRestart).finally(() => {
      this.launching = null
    })
    return this.launching
  }

  private async doLaunch(isRestart: boolean): Promise<void> {
    const server = this.server
    if (!server || this.stopped) throw new TunnelStartFailure('exited:1')
    let bin: string
    try {
      bin = await this.o.ensureBinary()
    } catch (err) {
      throw new TunnelStartFailure(err instanceof BinaryError ? 'no-binary' : 'no-binary')
    }
    if (this.stopped) throw new TunnelStartFailure('exited:1')
    const proc = new CloudflaredProcess({
      binary: bin,
      homeDir: this.o.homeDir,
      deps: this.o.deps,
      startTimeoutMs: this.o.startTimeoutMs ?? TRAVEL_PROCESS.startTimeoutMs,
      stopGraceMs: this.o.stopGraceMs,
      onLine: this.o.onProcessLine
    })
    this.proc = proc
    this.gate.rotate()
    proc.onState((s) => {
      if (this.proc !== proc || this.stopped) return
      if (s === 'online') {
        this.offline = false
        if (this.offlineTimer) clearTimeout(this.offlineTimer)
        this.offlineTimer = null
        if (this.ph === 'connecting') this.setPhase('online')
        else this.emit()
      } else if (s === 'connecting') {
        if (this.ph === 'online') this.setPhase('connecting')
        this.armOffline(TRAVEL_PROCESS.offlineAfterMs)
      }
    })
    proc.onExit(({ error }) => {
      if (this.proc === proc && !this.stopped) this.onProcessDied(error)
    })
    let started: { url: string; host: string }
    try {
      started = await proc.start(server.port)
    } catch (err) {
      if (this.proc === proc) this.proc = null
      await proc.stop().catch(() => undefined)
      throw new TunnelStartFailure(err instanceof TunnelStartError ? err.code : 'exited:1')
    }
    if (this.stopped) throw new TunnelStartFailure('exited:1')
    // El nombre debe casar EXACTAMENTE con `https://<palabras>.trycloudflare.com` (el proceso ya lo comprobó; aquí, defensa en profundidad).
    if (!TUNNEL_ORIGIN_RE.test(started.url)) {
      await proc.stop().catch(() => undefined)
      throw new TunnelStartFailure('bad-url')
    }
    this.pub = started.url
    this.setPhase('checking')
    const verdict = await this.check(started.url)
    if (this.stopped) throw new TunnelStartFailure('exited:1')
    if (verdict !== 'ok') {
      this.pub = null
      if (verdict === 'mismatch') this.o.audit?.({ kind: 'site-mismatch', why: 'tunnel' })
      await proc.stop().catch(() => undefined)
      this.proc = null
      throw new TunnelStartFailure(verdict === 'mismatch' ? 'site-mismatch' : 'unreachable')
    }
    this.onlineSince = Date.now()
    this.setPhase(proc.state() === 'online' ? 'online' : 'connecting')
    if (isRestart) for (const cb of this.restartCbs) cb(started.url)
  }

  private check(origin: string): Promise<SelfCheckResult> {
    const server = this.server as LanSignalingServer
    const ctx = {
      origin,
      token: this.gate.token,
      expected: (p: string) => server.readStatic(p),
      issueNonce: () => this.probes.issue()
    }
    if (this.o.selfCheck) return this.o.selfCheck(ctx)
    return runSelfCheck(origin, ctx.token, {
      get: this.o.httpGet ?? realHttpGet,
      expected: ctx.expected,
      issueNonce: ctx.issueNonce,
      maxMs: this.o.selfCheckMaxMs,
      cancelled: () => this.stopped
    })
  }

  // ── caídas ──

  private onProcessDied(error: StartErrorCode): void {
    const wasStable = this.onlineSince > 0 && Date.now() - this.onlineSince >= TRAVEL_PROCESS.offlineAfterMs
    if (wasStable) this.failures = 0
    this.onlineSince = 0
    this.pub = null // sin origen: todo es 503 hasta que haya túnel nuevo
    this.proc = null
    this.err = error
    this.failures++
    if (!canRestart(this.failures)) {
      this.setPhase('failed')
      for (const cb of this.failCbs) cb(error)
      return
    }
    this.setPhase('retrying')
    const delay =
      this.o.backoff?.(this.failures, error === 'rate') ?? backoffDelayMs(this.failures, { rate: error === 'rate', rand: this.o.rand })
    this.restartTimer = setTimeout(() => this.retry(), delay)
    this.restartTimer.unref?.()
  }

  private retry(): void {
    this.restartTimer = null
    if (this.stopped || !this.server) return
    if (this.o.allowed && !this.o.allowed()) return
    this.launch(true).catch((err: unknown) => {
      if (this.stopped) return
      const code = err instanceof TunnelStartFailure ? err.code : 'exited:1'
      this.onProcessDied(code as StartErrorCode)
    })
  }
}
