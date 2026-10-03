/**
 * Servicio del control remoto: apagado → vinculando (hay un QR vigente) → activo (solo reconexiones).
 *
 * Reglas de seguridad que aplica este módulo:
 *  - Apagado por defecto: sin puertos ni sockets hasta `start()`. Todo se corta con `stopAll()`.
 *  - El QR lleva un secreto de un solo uso (se guarda solo su sha256), caduca a los 120 s y se consume en el
 *    primer `hello` aunque falle.
 *  - Vincular exige confirmación LOCAL en el escritorio con el código de 6 dígitos de las huellas DTLS.
 *  - Máx. 3 dispositivos vinculados y un solo celular conectado a la vez; se apaga solo a los 30 min sin conexiones.
 */
import { randomBytes } from 'node:crypto'
import { pairingCode, toHex } from '@shared/remote/code'
import { LIMITS } from '@shared/remote/protocol'
import type { CallRequest, HttpRequest } from '@shared/remote/mux'
import type { RemoteEvent } from '@shared/remote/protocol'
import type {
  DeviceTtlDays,
  RemoteDeviceInfo,
  RemotePairRequest,
  RemotePolicyView,
  RemoteState,
  RemoteUnavailableReason
} from '@shared/ipc-remote'
import { DEVICE_TTL_OPTIONS } from '@shared/ipc-remote'
import type { AuditInput } from './audit'
import type { ConfirmHost } from './confirm-host'
import { toDeviceInfo, type DevicesStore } from './devices-store'
import { deviceFingerprint } from './confirm-queue'
import { EventBridge, type EventBridgeOptions, type EventSource } from './events'
import { NO_ORG_POLICY } from './org-policy'
import { PairingManager } from './pairing'
import { isUrgentFrame } from './engine-proxy'
import type { DeviceDispatch, RemoteEngineHost } from './engine-host'
import { PeerSession, type PeerAccess } from './peer-session'
import type { Clock } from './rate-limit'
import type { RtcAnswerer, RtcFactory } from './rtc'
import type { SignalHello, SignalingPeer, SignalingTransport } from './signaling/types'
import type { RemoteBackend } from './whitelist'

export interface RemoteServiceDeps {
  devices: DevicesStore
  /** Carga la librería WebRTC (lanza si no está disponible). */
  loadRtc: () => Promise<RtcFactory>
  getLanIp: () => string | null
  createTransport: (ip: string) => SignalingTransport
  backend: RemoteBackend & EventSource
  /** Cliente SSE del motor (solo se pide mientras haya un celular conectado). */
  getEventClient: EventBridgeOptions['getClient']
  qr: (text: string) => boolean[][]
  onChanged: (state: RemoteState) => void
  onPairRequest: (req: RemotePairRequest) => void
  now?: Clock
  /**
   * Control de acceso (T6): confirmación de cada conexión nueva, PIN, bloqueo y auditoría. En producción siempre se pasa
   * (`createRemote`); sin `confirmHost` las sesiones no filtran nada (solo para pruebas del protocolo).
   */
  confirmHost?: ConfirmHost
  audit?: (e: AuditInput) => void
  /** ¿Es una lectura? Con el celular bloqueado por inactividad solo se atienden lecturas (sin esto, ninguna). */
  isRead?: (r: CallRequest | HttpRequest) => boolean
  inactivityMs?: number
  /** Motor del protocolo v2 (T4): proxy IPC/HTTP, concentrador de eventos y su búfer. Sin él, toda llamada v2 responde `unavailable`. */
  engine?: RemoteEngineHost
  /** Plataforma sin función (`platform`) o ya conocida como no disponible. */
  unavailable?: () => RemoteUnavailableReason | null
  /** Política de la organización vigente (se consulta en caliente; sin ella, sin restricciones). */
  policy?: () => RemotePolicyView
}

/** Tiempo máximo para que una negociación WebRTC termine en un canal con celular autenticado. */
const NEGOTIATION_MS = 25_000
const FLUSH_MS = 250
/** Cada cuánto se relee la política de la organización mientras el control remoto está encendido. */
export const POLICY_POLL_MS = 5000

interface PeerRecord {
  signaling: SignalingPeer
  answerer: RtcAnswerer
  session: PeerSession | null
  dispatch: DeviceDispatch | null
  timer: ReturnType<typeof setTimeout> | null
  kind: 'pair' | 'resume'
  closed: boolean
}

export class RemoteService {
  private mode: RemoteState['mode'] = 'off'
  private transport: SignalingTransport | null = null
  private rtc: RtcFactory | null = null
  private ip = ''
  private origin = ''
  private readonly pairing: PairingManager
  private pairingSecret: string | null = null
  private pairingExpired = false
  private pairingTimer: ReturnType<typeof setTimeout> | null = null
  private idleTimer: ReturnType<typeof setTimeout> | null = null
  private idleStopAt: number | null = null
  private peers = new Set<PeerRecord>()
  private connected: PeerSession | null = null
  private pending: { req: RemotePairRequest; resolve: (accept: boolean) => void; peer: PeerRecord } | null = null
  private error: string | null = null
  private bridge: EventBridge | null = null
  private starting: Promise<RemoteState> | null = null
  private policyTimer: ReturnType<typeof setInterval> | null = null
  private lastPolicyKey = ''
  /** Última actividad por dispositivo (memoria): reconectar «en caliente» no vuelve a pedir el PIN. */
  private readonly lastActive = new Map<string, number>()

  constructor(private readonly d: RemoteServiceDeps) {
    this.pairing = new PairingManager(d.now)
  }

  private now(): number {
    return (this.d.now ?? Date.now)()
  }

  // ── estado ──

  private pol(): RemotePolicyView {
    return this.d.policy?.() ?? NO_ORG_POLICY
  }

  private unavailableReason(): RemoteUnavailableReason | null {
    return this.d.unavailable?.() ?? (this.pol().blocked ? 'policy' : this.d.devices.available ? null : 'no-safe-storage')
  }

  getState(): RemoteState {
    const unavailable = this.unavailableReason()
    const policy = this.pol()
    const devices: RemoteDeviceInfo[] = this.d.devices
      .list()
      .map((x) =>
        toDeviceInfo(
          x,
          this.connected?.deviceId === x.id,
          this.connected?.deviceId === x.id ? this.connected.accessView : null,
          this.now(),
          policy.deviceTtlDays
        )
      )
    const expiry = this.pairing.expiry
    return {
      available: unavailable === null,
      ...(unavailable ? { unavailable } : {}),
      mode: this.mode,
      pairing: this.mode !== 'off' && this.pairingSecret && this.pairing.active && expiry ? this.pairingView(expiry) : null,
      pairingExpired: this.mode !== 'off' && this.pairingExpired,
      devices,
      pendingPair: this.pending?.req ?? null,
      idleStopAt: this.mode === 'off' ? null : this.idleStopAt,
      error: this.error,
      ...(policy.managed ? { policy } : {})
    }
  }

  private qrCache: { url: string; qr: boolean[][] } | null = null

  private pairingView(expiresAt: number): NonNullable<RemoteState['pairing']> {
    const url = `${this.origin}/#s=${this.pairingSecret}`
    if (this.qrCache?.url !== url) this.qrCache = { url, qr: this.d.qr(url) }
    return { url, qr: this.qrCache.qr, expiresAt }
  }

  private changed(): void {
    this.d.onChanged(this.getState())
  }

  // ── ciclo de vida ──

  /** «Activar»: abre el servidor local y genera el primer QR. */
  start(): Promise<RemoteState> {
    if (this.mode !== 'off') return Promise.resolve(this.getState())
    this.starting ??= this.doStart().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async doStart(): Promise<RemoteState> {
    this.error = null
    const unavailable = this.unavailableReason()
    if (unavailable) {
      this.changed()
      return this.getState()
    }
    const ip = this.d.getLanIp()
    if (!ip) {
      this.error = 'no-network'
      this.changed()
      return this.getState()
    }
    let rtc: RtcFactory
    try {
      rtc = await this.d.loadRtc()
    } catch (err) {
      this.error = `no-rtc:${err instanceof Error ? err.message : String(err)}`
      this.changed()
      return this.getState()
    }
    const transport = this.d.createTransport(ip)
    transport.onPeer((p) => this.handlePeer(p))
    try {
      const { origin } = await transport.start({ authorize: (h) => this.authorize(h) })
      this.origin = origin
    } catch (err) {
      await transport.stop().catch(() => undefined)
      this.error = err instanceof Error ? err.message : String(err)
      this.changed()
      return this.getState()
    }
    this.rtc = rtc
    this.ip = ip
    this.transport = transport
    // Política sin «recordar»: los vínculos no sobreviven entre activaciones (se borran los que quedaran de antes).
    if (!this.pol().allowRemember) this.purgeDevices()
    this.mode = 'pairing'
    this.newPairingToken()
    this.armIdleTimer()
    this.startPolicyWatch()
    this.changed()
    return this.getState()
  }

  // ── política de la organización ──

  private startPolicyWatch(): void {
    this.lastPolicyKey = JSON.stringify(this.pol())
    if (this.policyTimer || !this.d.policy) return
    this.policyTimer = setInterval(() => this.applyPolicy(), POLICY_POLL_MS)
    this.policyTimer.unref?.()
  }

  /**
   * Relee la política y la aplica en caliente: bloqueada → se corta TODO ya (conexiones vivas incluidas); otros cambios
   * (tope de caducidad, máx. de celulares…) refrescan Ajustes. Se llama al activar, en cada conexión y por sondeo.
   */
  applyPolicy(): void {
    const p = this.pol()
    if (p.blocked && this.mode !== 'off') {
      this.d.audit?.({ kind: 'policy-blocked' })
      void this.stopAll()
      return
    }
    const key = JSON.stringify(p)
    if (key !== this.lastPolicyKey) {
      this.lastPolicyKey = key
      if (this.mode !== 'off') this.changed()
    }
  }

  /** Borra todos los vínculos sin auditoría de cada uno (los usa el modo sin «recordar»). */
  private purgeDevices(): void {
    if (this.d.devices.list().length === 0) return
    try {
      this.d.devices.revokeAll()
    } catch {
      /* sin cifrado no hay nada guardado */
    }
  }

  /** QR nuevo (el anterior deja de valer). Activa el modo si estaba apagado. */
  async newPairing(): Promise<RemoteState> {
    if (this.mode === 'off') return this.start()
    this.newPairingToken()
    this.changed()
    return this.getState()
  }

  private newPairingToken(): void {
    const token = this.pairing.create()
    this.pairingSecret = token.secret
    this.pairingExpired = false
    this.mode = this.mode === 'off' ? 'off' : 'pairing'
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = setTimeout(() => this.onPairingExpired(), Math.max(0, token.expiresAt - this.now()) + 20)
  }

  private onPairingExpired(): void {
    this.pairingTimer = null
    if (this.mode === 'off') return
    if (this.pairingSecret && !this.pairing.active) {
      this.pairingSecret = null
      this.pairingExpired = true
      this.mode = 'active'
      this.changed()
    }
  }

  /** «Cortar todo»: cierra conexiones, servidor y anula el QR. */
  async stopAll(): Promise<RemoteState> {
    const wasOff = this.mode === 'off' && !this.transport
    this.mode = 'off'
    this.pairing.revoke()
    this.pairingSecret = null
    this.pairingExpired = false
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = null
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.idleStopAt = null
    if (this.policyTimer) clearInterval(this.policyTimer)
    this.policyTimer = null
    this.bridge?.stop()
    this.bridge = null
    this.d.engine?.close()
    const peers = [...this.peers]
    this.peers.clear()
    this.connected = null
    const pending = this.pending
    this.pending = null
    pending?.resolve(false)
    this.d.confirmHost?.cancelAll()
    this.d.audit?.({ kind: 'stopped' })
    for (const p of peers) p.session?.bye('stopped')
    const transport = this.transport
    this.transport = null
    await transport?.stop().catch(() => undefined)
    if (peers.length > 0) await new Promise((r) => setTimeout(r, FLUSH_MS))
    for (const p of peers) this.closePeer(p, true)
    this.error = null
    if (!this.pol().allowRemember) this.purgeDevices()
    if (!wasOff) this.changed()
    return this.getState()
  }

  /**
   * Apagado definitivo (al salir de la app): corta todo. No se llama a `cleanup()` de la librería nativa: bloquea
   * el hilo principal hasta 10 s esperando a los pares y el proceso termina igualmente.
   */
  async dispose(): Promise<void> {
    await this.stopAll()
    this.rtc = null
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.idleStopAt = null
    if (this.mode === 'off' || this.connected) return
    this.idleStopAt = this.now() + LIMITS.idleShutdownMs
    this.idleTimer = setTimeout(() => void this.stopAll(), LIMITS.idleShutdownMs)
  }

  // ── señalización ──

  private authorize(h: SignalHello): boolean {
    this.applyPolicy()
    if (this.mode === 'off') return false
    if (h.mode === 'pair') return this.pairing.consume(h.secret)
    return this.d.devices.get(h.deviceId) !== null
  }

  private handlePeer(sp: SignalingPeer): void {
    if (this.mode === 'off' || !this.rtc) return sp.close()
    const hello = sp.hello
    if (hello.mode === 'pair') {
      // El secreto ya se consumió: el QR deja de valer (pase lo que pase con esta negociación).
      this.pairingSecret = null
      this.pairingExpired = false
      this.mode = 'active'
      if (this.pairingTimer) clearTimeout(this.pairingTimer)
      this.pairingTimer = null
      this.changed()
      if (this.pending || [...this.peers].some((p) => p.kind === 'pair')) return sp.close()
    }
    if (this.peers.size >= LIMITS.maxSignalSockets) return sp.close()

    const answerer = this.rtc.createAnswerer({ bindAddress: this.ip })
    const rec: PeerRecord = { signaling: sp, answerer, session: null, dispatch: null, timer: null, kind: hello.mode, closed: false }
    this.peers.add(rec)
    rec.timer = setTimeout(() => {
      if (!rec.session?.authed) this.closePeer(rec)
    }, NEGOTIATION_MS)

    let offerSdp = ''
    let answerSdp = ''
    sp.onOffer((sdp) => {
      offerSdp = sdp
      answerer.start(sdp)
    })
    sp.onIce((c, mid) => answerer.addRemoteCandidate(c, mid))
    sp.onClose(() => {
      // Si el canal aún no existe, no hay nada que esperar.
      if (!rec.session && !rec.closed) this.closePeer(rec)
    })
    answerer.onAnswer((sdp) => {
      answerSdp = sdp
      sp.sendAnswer(sdp)
    })
    answerer.onCandidate((c, mid) => sp.sendIce(c, mid))
    answerer.onGone(() => this.closePeer(rec, true))
    answerer.onChannel((channel) => {
      if (rec.session || rec.closed) return channel.close()
      const code = offerSdp && answerSdp ? pairingCode(offerSdp, answerSdp) : null
      const session: PeerSession = new PeerSession({
        channel,
        kind: hello.mode,
        deviceName: hello.mode === 'pair' ? hello.deviceName : undefined,
        deviceId: hello.mode === 'resume' ? hello.deviceId : undefined,
        code,
        devices: this.d.devices,
        backend: this.d.backend,
        makeDispatch: this.d.engine
          ? (id) => {
              rec.dispatch?.dispose()
              const dispatch = this.d.engine!.createDispatch({ id, name: this.d.devices.get(id)?.name ?? '?' })
              rec.dispatch = dispatch
              return dispatch
            }
          : undefined,
        events: this.d.engine?.events,
        urgent: this.d.engine ? isUrgentFrame : undefined,
        confirmPair: (info) => this.askConfirm(rec, info),
        onAuthed: (id) => this.onAuthed(session, id),
        onEnd: () => this.onSessionEnd(rec, session),
        access: this.access(),
        clock: this.d.now,
        limits: () => ({ capDays: this.pol().deviceTtlDays, maxDevices: this.pol().maxDevices })
      })
      rec.session = session
      channel.onOpen(() => {
        session.start()
        // El canal ya está abierto: la señalización no hace falta más (libera un socket).
        sp.close()
      })
    })
  }

  /** Cierra la negociación/conexión. Salvo `immediate`, da tiempo a que salga la última trama (`bye`). */
  private closePeer(rec: PeerRecord, immediate = false): void {
    if (rec.closed) return
    rec.closed = true
    if (rec.timer) clearTimeout(rec.timer)
    rec.timer = null
    this.peers.delete(rec)
    try {
      rec.signaling.close()
    } catch {
      /* ya cerrado */
    }
    rec.session?.close('closed')
    if (immediate) rec.answerer.close()
    else setTimeout(() => rec.answerer.close(), FLUSH_MS + 100).unref()
  }

  // ── vinculación ──

  private askConfirm(peer: PeerRecord, info: { deviceName: string; code: string }): Promise<boolean> {
    if (this.pending) return Promise.resolve(false)
    return new Promise<boolean>((resolve) => {
      const req: RemotePairRequest = { requestId: toHex(randomBytes(8)), deviceName: info.deviceName, code: info.code }
      this.pending = { req, resolve, peer }
      this.changed()
      this.d.onPairRequest(req)
    })
  }

  confirmPair(requestId: string, accept: boolean): RemoteState {
    const p = this.pending
    if (p && p.req.requestId === requestId) {
      this.pending = null
      p.resolve(accept)
      this.changed()
    }
    return this.getState()
  }

  revoke(deviceId: string): RemoteState {
    this.d.confirmHost?.cancelDevice(deviceId)
    this.lastActive.delete(deviceId)
    const rec = this.d.devices.get(deviceId)
    if (rec) this.d.audit?.({ kind: 'revoked', device: deviceFingerprint(deviceId), name: rec.name })
    if (this.connected?.deviceId === deviceId) this.connected.bye('revoked')
    for (const p of [...this.peers]) if (p.session?.deviceId === deviceId) p.session.bye('revoked')
    this.d.devices.revoke(deviceId)
    this.changed()
    return this.getState()
  }

  /** «Revocar todos»: quita todos los celulares y corta la conexión viva. */
  revokeAll(): RemoteState {
    const all = this.d.devices.list()
    if (all.length === 0) return this.getState()
    for (const rec of all) {
      this.d.confirmHost?.cancelDevice(rec.id)
      this.lastActive.delete(rec.id)
    }
    this.d.audit?.({ kind: 'revoked-all', n: all.length })
    if (this.connected) this.connected.bye('revoked')
    for (const p of [...this.peers]) p.session?.bye('revoked')
    this.d.devices.revokeAll()
    this.changed()
    return this.getState()
  }

  /** Plazo de validez de un celular (renueva su ventana desde ahora). */
  setDeviceTtl(deviceId: string, days: DeviceTtlDays): RemoteState {
    if (DEVICE_TTL_OPTIONS.includes(days)) this.d.devices.setTtl(deviceId, days, this.now())
    this.changed()
    return this.getState()
  }

  // ── acceso (T6) ──

  private access(): PeerAccess | undefined {
    const host = this.d.confirmHost
    if (!host) return undefined
    return {
      confirmConnection: async ({ deviceId, deviceName }) => {
        const r = await host.requestConnection({ deviceId, deviceName, detail: [this.origin] })
        if (r.outcome === 'approved' && r.remember && this.pol().allowConfirmRemember12h) {
          this.d.devices.setTrust(deviceId, this.now() + LIMITS.rememberMs)
        }
        return { approved: r.outcome === 'approved', outcome: r.outcome }
      },
      trusted: (id) => this.pol().allowConfirmRemember12h && (this.d.devices.trustedUntil(id) ?? 0) > this.now(),
      // Con `requirePin` de la política no hay reconexión «en caliente»: el PIN se pide siempre.
      lastActiveAt: (id) => (this.pol().requirePin ? null : (this.lastActive.get(id) ?? null)),
      noteActive: (id, t) => this.lastActive.set(id, t),
      onRevokeDevice: (id) => void this.revoke(id),
      onChange: () => this.changed(),
      audit: (e) => this.d.audit?.(e),
      isRead: this.d.isRead,
      inactivityMs: this.d.inactivityMs
    }
  }

  /** «Recordar 12 h» la confirmación de conexión de un dispositivo (`false` = volver a confirmar cada vez). */
  setRemember(deviceId: string, remember: boolean): RemoteState {
    const allowed = this.pol().allowConfirmRemember12h
    if (this.d.devices.get(deviceId)) this.d.devices.setTrust(deviceId, remember && allowed ? this.now() + LIMITS.rememberMs : null)
    this.changed()
    return this.getState()
  }

  /** Borra el PIN: el celular tendrá que fijar uno nuevo al reconectar (se le corta la conexión actual). */
  resetPin(deviceId: string): RemoteState {
    const rec = this.d.devices.get(deviceId)
    if (rec && this.d.devices.resetPin(deviceId)) {
      this.d.audit?.({ kind: 'pin-reset', device: deviceFingerprint(deviceId), name: rec.name })
      this.lastActive.delete(deviceId)
      if (this.connected?.deviceId === deviceId) this.connected.bye('timeout')
    }
    this.changed()
    return this.getState()
  }

  // ── sesiones ──

  private onAuthed(session: PeerSession, deviceId: string): boolean {
    this.applyPolicy()
    if (this.mode === 'off') return false
    const cur = this.connected
    if (cur && cur !== session && cur.state !== 'closed') {
      if (cur.deviceId !== deviceId) return false
      cur.bye('other-device') // el mismo celular volvió a conectar: la sesión vieja ya no sirve
    }
    this.connected = session
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.idleStopAt = null
    this.d.devices.touch(deviceId)
    if (!this.bridge) {
      this.bridge = new EventBridge({
        getClient: this.d.getEventClient,
        source: this.d.backend,
        emit: (ev: RemoteEvent) => this.connected?.sendEvent(ev)
      })
    }
    this.bridge.start()
    this.d.engine?.hub.start()
    this.changed()
    return true
  }

  private onSessionEnd(rec: PeerRecord, session: PeerSession): void {
    rec.dispatch?.dispose()
    rec.dispatch = null
    if (this.pending?.peer === rec) {
      const p = this.pending
      this.pending = null
      p.resolve(false)
    }
    if (session.deviceId) this.d.confirmHost?.cancelDevice(session.deviceId)
    if (this.connected === session) {
      this.connected = null
      this.d.engine?.hub.stop()
      this.bridge?.stop()
      this.bridge = null
      this.armIdleTimer()
    }
    this.closePeer(rec)
    if (this.mode !== 'off') this.changed()
  }
}
