/**
 * Una conexión del celular por el DataChannel (cifrado DTLS): autenticación, límites y despacho de la lista blanca.
 *
 *  - Handshake v3 (los dos modos; `@shared/remote/handshake`): lo primero que se admite es `hs1`; el Mac responde `hs2`; el
 *    celular manda `hs3` con un HMAC ligado a las huellas DTLS de los dos extremos y a nonces de un solo uso. Ninguna
 *    credencial viaja. Con un intermediario las huellas difieren y el HMAC no cuadra: `auth-failed`, sin pistas (un solo
 *    intento). El Mac prueba al celular que tiene la clave (`proof` en `authed`/`pair-pending`) ANTES de que el celular mande
 *    el PIN o cualquier otra cosa.
 *  - Vinculación (`pair`): clave del QR (`pairKey(q)`). Tras `hs3` correcto, el escritorio pide confirmación local mostrando el
 *    código de 6 dígitos (`sasCode`, con compromiso previo) y, si el dueño acepta, entrega `paired{deviceId, deviceSecret}` POR
 *    EL CANAL ya ligado (el celular guarda el secreto; aquí solo su hash).
 *  - Reconexión (`resume`): clave del dispositivo (`devices.authKey`).
 *  - Antes de autenticar solo se admiten `ping`, `hs1` (en `await-hs1`) y `hs3` (en `await-hs3`); cualquier otra cosa es una
 *    violación, y un `hs*` fuera de orden corta enseguida. El plazo (10 s) cubre todo el handshake.
 *  - El plazo de validez del vínculo se renueva cuando el acceso se abre (PIN o reconexión en caliente), no al presentar la clave.
 *  - 10 req/s (ráfaga 20), 6 prompts/min, tramas ≤ 64 KiB, 3 violaciones = desconexión.
 *  - Protocolo v2 (`call`/`http`/`sub`/`chunk`/…): lo atiende el multiplexor compartido (`@shared/remote/mux`). Aquí solo
 *    se cablea: validación, cubos, salida con prioridad y `bufferedAmount`. El despacho es `deps.dispatch` (inyectable);
 *    sin él, toda llamada v2 responde `unavailable` (el motor no se expone todavía).
 */
import { randomBytes } from 'node:crypto'
import { HostHandshake, type Fps, type Rand } from '@shared/remote/handshake'
import { LIMITS, encodeFrame, isMuxClientFrame, parseClientFrame, utf8Length } from '@shared/remote/protocol'
import type {
  ByeReason,
  CallFrame,
  ClientFrame,
  DeniedReason,
  HostFrame,
  HttpFrame,
  Hs1Frame,
  Hs3Frame,
  MuxClientFrame,
  RemoteEvent,
  RequestFrame
} from '@shared/remote/protocol'
import {
  BUFFER,
  Mux,
  Outbox,
  PRIO,
  type CallRequest,
  type EventLog,
  type HttpRequest,
  type MuxDispatch,
  type Prio
} from '@shared/remote/mux'
import { AccessGate, guardDispatch, type AccessView, type ConnectionDecision } from './access-gate'
import type { AuditInput } from './audit'
import type { DevicesStore } from './devices-store'
import { DevicesLimitError, EXPIRY_WARN_MS } from './devices-store'
import { RateLimiter, type Clock } from './rate-limit'
import { deviceFingerprint } from './confirm-queue'
import { dispatch, type RemoteBackend } from './whitelist'
import type { RtcChannel } from './rtc'

/** Control de acceso por conexión (T6: confirmación de conexión, PIN, bloqueo). Sin él la sesión no filtra nada (solo pruebas). */
export interface PeerAccess {
  confirmConnection(info: { deviceId: string; deviceName: string }): Promise<ConnectionDecision>
  trusted(deviceId: string): boolean
  lastActiveAt(deviceId: string): number | null
  noteActive(deviceId: string, t: number): void
  /** 5 fallos de PIN: el servicio revoca el dispositivo. */
  onRevokeDevice(deviceId: string): void
  /** Cambió el estado de acceso (Ajustes). */
  onChange(): void
  audit(e: AuditInput): void
  /** ¿Es lectura? (con el celular bloqueado por inactividad solo se atienden lecturas; sin esto, ninguna). */
  isRead?: (r: CallRequest | HttpRequest) => boolean
  inactivityMs?: number
  /** ¿Hay que confirmar en el Mac esta conexión de un dispositivo ya vinculado? Sin esto, sí (comportamiento anterior). */
  needsConfirm?(deviceId: string): boolean
}

export type PeerState = 'init' | 'await-hs1' | 'await-hs3' | 'pair-wait' | 'authed' | 'closed'

export interface PeerSessionDeps {
  channel: RtcChannel
  kind: 'pair' | 'resume'
  /** Nombre que anunció el celular (ya saneado). Solo en `pair`. */
  deviceName?: string
  /** Dispositivo que dice ser (solo en `resume`; se comprueba con el handshake). */
  deviceId?: string
  /** Huellas DTLS del offer y del answer vistas por la pila del Mac (`null` = faltan o no son estrictas: se rechaza). */
  fps: Fps | null
  /** Solo `pair`: identificador y clave del QR (`pairId(q)`, `pairKey(q)`). */
  qid?: string
  pairKey?: Uint8Array
  /** Solo `pair`: resultado del handshake (`true` = `hs3` correcto: el QR se consume; `false` = intento fallido). */
  onPairProof?(ok: boolean): boolean | void
  /** Azar (por defecto `node:crypto`). Inyectable para las pruebas. */
  rand?: Rand
  devices: DevicesStore
  backend: RemoteBackend
  /** Pide confirmación al dueño en el escritorio (con el código de 6 dígitos que verá también el celular). */
  confirmPair(info: { deviceName: string; code: string }): Promise<boolean>
  /** Autenticado: el servicio decide si acepta (un solo celular a la vez). `false` = se corta con `other-device`. */
  onAuthed(deviceId: string): boolean
  onEnd(reason: string): void
  /** Despachador de `call`/`http`/`sub` del protocolo v2 (T2/T3/T4). Sin él se rechaza todo. */
  dispatch?: MuxDispatch
  /** Crea el despachador cuando el dispositivo ya está autenticado (recibe el `deviceId` VERIFICADO). Gana `dispatch` si ambos. */
  makeDispatch?: (deviceId: string) => MuxDispatch
  /** Búfer circular de eventos que sirve a `sub` (el servicio lo conserva entre conexiones para reanudar). */
  events?: EventLog
  /** ¿Es una petición de control/permisos (prioridad máxima en la respuesta)? */
  urgent?: (f: CallFrame | HttpFrame) => boolean
  access?: PeerAccess
  /** Límites de la política de la organización (tope de caducidad en días y nº máximo de celulares). Sin él, solo los de fábrica. */
  limits?: () => { capDays: number | null; maxDevices: number }
  clock?: Clock
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
}

export class PeerSession {
  private _state: PeerState = 'init'
  private _deviceId: string | null = null
  private readonly limiter: RateLimiter
  private authTimer: unknown = null
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (h: unknown) => void
  private readonly outbox: Outbox
  private mux: Mux | null = null
  private gate: AccessGate | null = null
  private hs: HostHandshake | null = null
  /** Se llamó a `start()` (el canal llegó a abrirse): un fallo desde aquí cuenta contra el QR. */
  private _started = false

  constructor(private readonly d: PeerSessionDeps) {
    this.limiter = new RateLimiter(d.clock)
    this.outbox = new Outbox({
      send: (text) => {
        if (!d.channel.isOpen()) return false
        d.channel.send(text)
        return true
      },
      bufferedAmount: () => d.channel.bufferedAmount?.() ?? 0
    })
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

  /** ¿Llegó a abrirse el canal? (si no, un fallo no cuenta como intento de vinculación fallido). */
  get started(): boolean {
    return this._started
  }

  /** Estado de acceso visible en Ajustes (`null` = sin control de acceso o sin autenticar). */
  get accessView(): AccessView | null {
    return this._state === 'authed' ? (this.gate?.view ?? null) : null
  }

  /** Se llama al abrirse el canal (idempotente). */
  start(): void {
    if (this._started || this._state === 'closed') return
    this._started = true
    const { channel } = this.d
    channel.setBufferedAmountLowThreshold?.(BUFFER.low)
    channel.onBufferedAmountLow?.(() => this.outbox.pump())
    channel.onMessage((raw) => this.onMessage(raw))
    channel.onClose(() => this.finish('closed'))
    const { fps, kind } = this.d
    // Sin huellas estrictas en los dos SDP no hay a qué ligar el handshake: se rechaza (nada de degradar).
    if (!fps) return this.failHandshake(false)
    const rand = this.d.rand ?? ((n: number) => new Uint8Array(randomBytes(n)))
    if (kind === 'pair') {
      if (!this.d.qid || !this.d.pairKey) return this.failHandshake(false)
      this.hs = new HostHandshake({ mode: 'pair', qid: this.d.qid, key: this.d.pairKey, fps, rand })
    } else {
      // Si el dispositivo ya no existe (revocado a mitad), se usa la clave de relleno: mismo trabajo, siempre `auth-failed`.
      const key = this.d.deviceId ? this.d.devices.authKey(this.d.deviceId) : null
      this.hs = new HostHandshake({ mode: 'resume', expectId: this.d.deviceId ?? '', key, fps, rand })
    }
    this._state = 'await-hs1'
    this.authTimer = this.setTimer(() => {
      if (this._state === 'await-hs1' || this._state === 'await-hs3') this.handshakeTimeout()
    }, LIMITS.authTimeoutMs)
  }

  // ── salida ──

  private send(frame: HostFrame): boolean {
    if (this._state === 'closed' || !this.d.channel.isOpen()) return false
    const s = encodeFrame(frame)
    if (!s) return false
    const prio: Prio = frame.t === 'evt' ? PRIO.event : frame.t === 'res' ? PRIO.response : PRIO.control
    this.outbox.enqueue(prio, s)
    return true
  }

  /** Multiplexor v2 (se crea al autenticar; cada conexión tiene el suyo). */
  private getMux(): Mux {
    if (this.mux) return this.mux
    // El despachador de T4 se crea UNA vez por conexión (no en cada trama); T6 lo envuelve con el control de acceso.
    const baseDispatch = this.d.dispatch ?? (this._deviceId ? this.d.makeDispatch?.(this._deviceId) : undefined)
    this.mux = new Mux({
      role: 'host',
      out: this.outbox,
      dispatch:
        this.gate && baseDispatch
          ? guardDispatch(baseDispatch, this.gate, {
              isRead: this.d.access?.isRead,
              onPolicyDenied: (r) => this.d.access?.audit({ kind: 'policy-denied', ...this.who(), ...r })
            })
          : baseDispatch,
      events: this.d.events,
      urgent: this.d.urgent,
      // Defensa en profundidad: sin el acceso abierto no se emite ningún evento (además de cerrar las suscripciones al bloquear).
      canEmit: () => !this.gate || this.gate.isOpen,
      onViolation: () => this.violation()
    })
    return this.mux
  }

  sendEvent(ev: RemoteEvent): void {
    if (this._state === 'authed' && (!this.gate || this.gate.isOpen)) this.send({ t: 'evt', ev })
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
    this.gate?.dispose()
    this.mux?.close()
    this.setTimer(() => {
      this.outbox.kill()
      this.d.channel.close()
    }, 150)
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
    this.gate?.dispose()
    this.mux?.close()
    this.outbox.kill()
    this.d.onEnd(reason)
  }

  private clearAuthTimer(): void {
    if (this.authTimer) this.clearTimer(this.authTimer)
    this.authTimer = null
  }

  // ── handshake ──

  /** Corte inmediato del handshake (un solo intento): sin pistas sobre qué falló. */
  private failHandshake(proofChecked: boolean): void {
    if (this._state === 'closed') return
    if (this.d.kind === 'pair') {
      // Solo cuenta contra el QR si el canal llegó a abrirse (un canal que nunca abrió no es un intento).
      if (this._started) this.d.onPairProof?.(false)
      this.send({ t: 'denied', reason: 'rejected' })
      this.closeSoon('denied:rejected')
      return
    }
    // Una prueba que no cuadra puede ser un intermediario o un secreto robado: queda en la auditoría (huella del que dijo ser).
    if (proofChecked) this.auditBadProof()
    this.send({ t: 'auth-failed' })
    this.closeSoon('auth-failed')
  }

  private auditBadProof(): void {
    const id = this.d.deviceId
    this.d.access?.audit({
      kind: 'auth-bad-proof',
      ...(id ? { device: deviceFingerprint(id), name: this.d.devices.get(id)?.name } : {})
    })
  }

  private handshakeTimeout(): void {
    if (this.d.kind === 'pair') this.d.onPairProof?.(false)
    this.bye('timeout')
  }

  private onHs1(f: Hs1Frame): void {
    if (this._state !== 'await-hs1' || !this.hs) return this.failHandshake(false)
    const hs2 = this.hs.onHello(f)
    if (!hs2) return this.failHandshake(false)
    this._state = 'await-hs3'
    this.send(hs2)
  }

  private onHs3(f: Hs3Frame): void {
    if (this._state !== 'await-hs3' || !this.hs) return this.failHandshake(false)
    const res = this.hs.onProof(f)
    this.hs = null
    if (!res.ok) return this.failHandshake(true)
    this.clearAuthTimer()
    if (this.d.kind === 'pair') return void this.afterPairProof(res.proof, res.sas)
    this.afterResumeProof(res.proof)
  }

  // ── reconexión ──

  private afterResumeProof(proof: string): void {
    const deviceId = this.d.deviceId as string
    const { capDays } = this.limits()
    const now = this.nowMs()
    if (this.d.devices.expiryState(deviceId, now, capDays) === 'expired') {
      // El Mac ya verificó la prueba del celular, así que puede probar quién es al decir `expired`.
      this.d.access?.audit({ kind: 'expired', device: deviceFingerprint(deviceId), name: this.d.devices.get(deviceId)?.name })
      this.send({ t: 'auth-failed', why: 'expired', proof })
      this.closeSoon('expired')
      return
    }
    this._deviceId = deviceId
    this._state = 'authed'
    // El plazo NO se renueva aquí (H11): lo hace el acceso al abrirse (PIN o reconexión en caliente). `expiresAt` es el vigente.
    const expiresAt = this.d.devices.expiresAt(deviceId, capDays)
    this.send({
      t: 'authed',
      proof,
      ...(expiresAt === null ? {} : { expiresAt }),
      ...(expiresAt !== null && expiresAt - now <= EXPIRY_WARN_MS ? { expiring: true } : {})
    })
    if (!this.d.onAuthed(deviceId)) return this.bye('other-device')
    this.d.access?.audit({ kind: 'connected', ...this.who() })
    // Sin control de acceso (solo pruebas del protocolo) no hay «apertura» que renueve el plazo: se renueva al autenticar.
    if (!this.d.access) this.d.devices.touch(deviceId, now)
    this.startGate(false)
  }

  // ── vinculación ──

  private async afterPairProof(proof: string, code: string | undefined): Promise<void> {
    const { deviceName } = this.d
    this._state = 'pair-wait'
    // `hs3` correcto: el QR se consume (de un solo uso), pase lo que pase después.
    const consumed = this.d.onPairProof?.(true)
    const deny = (reason: DeniedReason): void => {
      this.send({ t: 'denied', reason })
      this.closeSoon(`denied:${reason}`)
    }
    // `false` = el QR ya no valía (caducó entre el `hello` y el `hs3`): no se sigue.
    if (!code || consumed === false) return deny('rejected')
    const lim = this.limits()
    // Los vínculos caducados no ocupan hueco.
    this.d.devices.pruneExpired(this.nowMs(), lim.capDays)
    if (this.d.devices.list().length >= lim.maxDevices) return deny('limit')
    this.send({ t: 'pair-pending', proof })
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
      created = this.d.devices.add(deviceName || '?', this.nowMs(), undefined, lim.capDays, lim.maxDevices)
    } catch (err) {
      return deny(err instanceof DevicesLimitError ? 'limit' : 'rejected')
    }
    this._deviceId = created.id
    this._state = 'authed'
    this.send({ t: 'paired', deviceId: created.id, deviceSecret: created.secret })
    if (!this.d.onAuthed(created.id)) return this.bye('other-device')
    this.d.access?.audit({ kind: 'paired', ...this.who() })
    if (!this.d.access) this.d.devices.touch(created.id, this.nowMs())
    this.startGate(true)
  }

  // ── entrada ──

  private violation(): void {
    if (this.limiter.violation()) this.bye('violations')
  }

  /** Procesa una trama del celular (público para las pruebas). */
  onMessage(raw: unknown): void {
    if (this._state === 'closed') return
    const parsed = parseClientFrame(raw)
    if (!parsed.ok) {
      this.violation()
      return
    }
    const f: ClientFrame = parsed.value
    if (isMuxClientFrame(f)) {
      this.onMux(f, raw as string)
      return
    }
    if (!this.limiter.allowRequest()) {
      this.violation()
      return
    }
    if (f.t === 'ping') {
      this.send({ t: 'pong' })
      return
    }
    if (f.t === 'hs1') {
      this.onHs1(f)
      return
    }
    if (f.t === 'hs3') {
      this.onHs3(f)
      return
    }
    if (f.t === 'lock') {
      if (this._state !== 'authed') this.violation()
      else this.gate?.lockNow()
      return
    }
    if (f.t === 'pin-set' || f.t === 'pin-verify') {
      if (this._state !== 'authed') this.violation()
      else if (this.gate) void this.gate.onPin(f)
      return
    }
    if (this._state !== 'authed') {
      this.violation()
      return
    }
    void this.onRequest(f)
  }

  private onMux(f: MuxClientFrame, raw: string): void {
    // Solo autenticado; cada clase de trama tiene su cubo (un exceso es una violación, no se encola).
    const allowed =
      this._state === 'authed' && (f.t === 'call' || f.t === 'http' || f.t === 'sub' ? this.limiter.allowCall() : this.limiter.allowFlood())
    if (!allowed) return this.violation()
    this.getMux().receive(f, utf8Length(raw))
  }

  // ── acceso (T6) ──

  private nowMs(): number {
    return (this.d.clock ?? Date.now)()
  }

  private limits(): { capDays: number | null; maxDevices: number } {
    const l = this.d.limits?.()
    return { capDays: l?.capDays ?? null, maxDevices: Math.min(l?.maxDevices ?? LIMITS.maxDevices, LIMITS.maxDevices) }
  }

  private who(): { device?: string; name?: string } {
    const id = this._deviceId
    if (!id) return {}
    return { device: deviceFingerprint(id), name: this.d.devices.get(id)?.name }
  }

  private startGate(fresh: boolean): void {
    const a = this.d.access
    const id = this._deviceId
    if (!a || !id) return
    this.gate = new AccessGate({
      deviceId: id,
      fresh,
      devices: this.d.devices,
      now: this.d.clock ?? Date.now,
      setTimer: this.setTimer,
      clearTimer: this.clearTimer,
      needsConfirm: a.needsConfirm ? () => a.needsConfirm!(id) : undefined,
      trusted: () => a.trusted(id),
      confirmConnection: () => a.confirmConnection({ deviceId: id, deviceName: this.d.devices.get(id)?.name ?? '?' }),
      send: (f) => void this.send(f),
      onChange: () => a.onChange(),
      onDenied: (reason) => {
        this.send({ t: 'denied', reason })
        this.closeSoon(`denied:${reason}`)
      },
      onRevoke: () => a.onRevokeDevice(id),
      audit: (e) => a.audit({ ...e, ...this.who() }),
      lastActiveAt: a.lastActiveAt(id),
      noteActive: (t) => a.noteActive(id, t),
      inactivityMs: a.inactivityMs,
      // H3: el bloqueo cierra las suscripciones abiertas y descarta los eventos en cola.
      onLocked: () => this.mux?.endSubs('forbidden', 'locked'),
      // H11: el plazo de validez se renueva al abrirse el acceso, no al presentar la clave.
      onOpened: () => this.d.devices.touch(id, this.nowMs())
    })
    this.gate.start()
  }

  private async onRequest(f: RequestFrame): Promise<void> {
    if (f.m === 'session.prompt' && !this.limiter.allowPrompt()) {
      this.send({ t: 'res', id: f.id, ok: false, error: { code: 'rate-limited' } })
      this.violation()
      return
    }
    if (this.gate && !this.gate.isOpen) {
      this.send({ t: 'res', id: f.id, ok: false, error: { code: 'forbidden' } })
      return
    }
    this.gate?.touch()
    const res = await dispatch(f, this.d.backend)
    if (this._state !== 'authed') return
    if (!this.send(res)) this.send({ t: 'res', id: f.id, ok: false, error: { code: 'failed' } })
  }
}
