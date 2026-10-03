/**
 * Una conexión del celular por el DataChannel (cifrado DTLS): autenticación, límites y despacho de la lista blanca.
 *
 *  - Vinculación (`pair`): el escritorio pide confirmación local mostrando el código de 6 dígitos y, si el dueño
 *    acepta, entrega `paired{deviceId, deviceSecret}` POR EL CANAL (el celular guarda el secreto; aquí solo su hash).
 *  - Reconexión (`resume`): la primera trama debe ser `auth{deviceId, secret}` (nunca por HTTP ni señalización).
 *  - Antes de autenticar solo se admiten `auth` (en reconexión) y `ping`; cualquier otra cosa es una violación.
 *  - 10 req/s (ráfaga 20), 6 prompts/min, tramas ≤ 64 KiB, 3 violaciones = desconexión.
 */
import { LIMITS, encodeFrame, parseClientFrame } from '@shared/remote/protocol'
import type { ByeReason, ClientFrame, DeniedReason, HostFrame, RemoteEvent, RequestFrame } from '@shared/remote/protocol'
import type { DevicesStore } from './devices-store'
import { DevicesLimitError } from './devices-store'
import { RateLimiter, type Clock } from './rate-limit'
import { dispatch, type RemoteBackend } from './whitelist'
import type { RtcChannel } from './rtc'

export type PeerState = 'init' | 'pair-wait' | 'await-auth' | 'authed' | 'closed'

export interface PeerSessionDeps {
  channel: RtcChannel
  kind: 'pair' | 'resume'
  /** Nombre que anunció el celular (ya saneado). Solo en `pair`. */
  deviceName?: string
  /** Dispositivo que dice ser (solo en `resume`; se comprueba con `auth`). */
  deviceId?: string
  /** Código de 6 dígitos de las huellas DTLS (`null` = faltan huellas: se rechaza). */
  code: string | null
  devices: DevicesStore
  backend: RemoteBackend
  /** Pide confirmación al dueño en el escritorio. */
  confirmPair(info: { deviceName: string; code: string }): Promise<boolean>
  /** Autenticado: el servicio decide si acepta (un solo celular a la vez). `false` = se corta con `other-device`. */
  onAuthed(deviceId: string): boolean
  onEnd(reason: string): void
  clock?: Clock
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

export class PeerSession {
  private _state: PeerState = 'init'
  private _deviceId: string | null = null
  private readonly limiter: RateLimiter
  private authTimer: unknown = null
  private started = false
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void

  constructor(private readonly d: PeerSessionDeps) {
    this.limiter = new RateLimiter(d.clock)
    this.setTimer = d.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clearTimer = d.clearTimer ?? ((h) => clearTimeout(h as NodeJS.Timeout))
  }

  get state(): PeerState {
    return this._state
  }

  get deviceId(): string | null {
    return this._deviceId
  }

  get authed(): boolean {
    return this._state === 'authed'
  }

  /** Se llama al abrirse el canal (idempotente). */
  start(): void {
    if (this.started || this._state === 'closed') return
    this.started = true
    const { channel } = this.d
    channel.onMessage((raw) => this.onMessage(raw))
    channel.onClose(() => this.finish('closed'))
    if (this.d.kind === 'pair') void this.runPairing()
    else {
      this._state = 'await-auth'
      this.authTimer = this.setTimer(() => {
        if (this._state === 'await-auth') this.bye('timeout')
      }, LIMITS.authTimeoutMs)
    }
  }

  // ── salida ──

  private send(frame: HostFrame): boolean {
    if (this._state === 'closed' || !this.d.channel.isOpen()) return false
    const s = encodeFrame(frame)
    if (!s) return false
    this.d.channel.send(s)
    return true
  }

  sendEvent(ev: RemoteEvent): void {
    if (this._state === 'authed') this.send({ t: 'evt', ev })
  }

  /** Despide al celular con un motivo y cierra tras dar tiempo a que salga la trama. */
  bye(reason: ByeReason): void {
    if (this._state === 'closed') return
    this.send({ t: 'bye', reason })
    this.closeSoon(reason)
  }

  private closeSoon(reason: string): void {
    this._state = 'closed'
    this.clearAuthTimer()
    this.setTimer(() => this.d.channel.close(), 150)
    this.d.onEnd(reason)
  }

  /** Cierre inmediato (apagado). */
  close(reason = 'stopped'): void {
    if (this._state === 'closed') return
    this.finish(reason)
    this.d.channel.close()
  }

  private finish(reason: string): void {
    if (this._state === 'closed') return
    this._state = 'closed'
    this.clearAuthTimer()
    this.d.onEnd(reason)
  }

  private clearAuthTimer(): void {
    if (this.authTimer) this.clearTimer(this.authTimer)
    this.authTimer = null
  }

  // ── vinculación ──

  private async runPairing(): Promise<void> {
    const { code, deviceName } = this.d
    this._state = 'pair-wait'
    const deny = (reason: DeniedReason): void => {
      this.send({ t: 'denied', reason })
      this.closeSoon(`denied:${reason}`)
    }
    if (!code) return deny('rejected')
    if (this.d.devices.list().length >= LIMITS.maxDevices) return deny('limit')
    this.send({ t: 'pair-pending' })
    let accepted = false
    let timer: unknown = null
    try {
      accepted = await Promise.race([
        this.d.confirmPair({ deviceName: deviceName || '?', code }),
        new Promise<boolean>((r) => {
          timer = this.setTimer(() => r(false), LIMITS.confirmTtlMs)
        })
      ])
    } catch {
      accepted = false
    } finally {
      if (timer) this.clearTimer(timer)
    }
    if (this._state !== 'pair-wait') return // el celular se fue mientras tanto
    if (!accepted) return deny('rejected')
    let created: { id: string; secret: string }
    try {
      created = this.d.devices.add(deviceName || '?')
    } catch (err) {
      return deny(err instanceof DevicesLimitError ? 'limit' : 'rejected')
    }
    this._deviceId = created.id
    this._state = 'authed'
    this.send({ t: 'paired', deviceId: created.id, deviceSecret: created.secret })
    if (!this.d.onAuthed(created.id)) this.bye('other-device')
  }

  // ── entrada ──

  private violation(): void {
    if (this.limiter.violation()) this.bye('violations')
  }

  /** Procesa una trama del celular (público para las pruebas). */
  onMessage(raw: unknown): void {
    if (this._state === 'closed') return
    if (!this.limiter.allowRequest()) {
      this.violation()
      return
    }
    const parsed = parseClientFrame(raw)
    if (!parsed.ok) {
      this.violation()
      return
    }
    const f: ClientFrame = parsed.value
    if (f.t === 'ping') {
      this.send({ t: 'pong' })
      return
    }
    if (f.t === 'auth') {
      this.onAuth(f.deviceId, f.secret)
      return
    }
    if (this._state !== 'authed') {
      this.violation()
      return
    }
    void this.onRequest(f)
  }

  private onAuth(deviceId: string, secret: string): void {
    if (this.d.kind !== 'resume' || this._state !== 'await-auth') {
      this.violation()
      return
    }
    // Una sola oportunidad: si falla, se corta (sin pistas sobre qué falló).
    const ok = deviceId === this.d.deviceId && this.d.devices.verify(deviceId, secret)
    if (!ok) {
      this.send({ t: 'auth-failed' })
      this.closeSoon('auth-failed')
      return
    }
    this.clearAuthTimer()
    this._deviceId = deviceId
    this._state = 'authed'
    this.d.devices.touch(deviceId)
    this.send({ t: 'authed' })
    if (!this.d.onAuthed(deviceId)) this.bye('other-device')
  }

  private async onRequest(f: RequestFrame): Promise<void> {
    if (f.m === 'session.prompt' && !this.limiter.allowPrompt()) {
      this.send({ t: 'res', id: f.id, ok: false, error: { code: 'rate-limited' } })
      this.violation()
      return
    }
    const res = await dispatch(f, this.d.backend)
    if (this._state !== 'authed') return
    if (!this.send(res)) this.send({ t: 'res', id: f.id, ok: false, error: { code: 'failed' } })
  }
}
