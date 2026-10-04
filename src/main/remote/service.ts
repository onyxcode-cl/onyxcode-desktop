/**
 * Servicio del control remoto: apagado → vinculando (hay un QR vigente) → activo (solo reconexiones).
 *
 * Reglas de seguridad que aplica este módulo:
 *  - Apagado por defecto: sin puertos ni sockets hasta `start()`. Todo se corta con `stopAll()`.
 *  - El QR lleva un secreto `q` de un solo uso que NO viaja por la señalización (el `hello` lleva solo `qid`); caduca a los
 *    120 s, un `qid` ajeno no lo consume (5 fallos lo anulan) y solo un handshake correcto (`hs3`) lo consume.
 *  - Vincular exige confirmación LOCAL en el escritorio con el código de 6 dígitos (con compromiso previo, ligado a las huellas DTLS).
 *  - La reconexión se autentica con un HMAC ligado a las huellas DTLS (sin enviar ninguna credencial).
 *  - Máx. 3 dispositivos vinculados y un solo celular conectado a la vez; se apaga solo a los 30 min sin conexiones.
 */
import { randomBytes } from 'node:crypto'
import { sdpFingerprintStrict, toHex } from '@shared/remote/code'
import {
  CLOUD_STUN_URL,
  encodePairCode,
  formatPairCode,
  pairHostToken,
  pairRoom,
  pairSecretFromCode,
  roomOfToken
} from '@shared/remote/cloud'
import { LIMITS } from '@shared/remote/protocol'
import type { IceServerSpec, RemoteCap } from '@shared/remote/protocol'
import type { CallRequest, HttpRequest } from '@shared/remote/mux'
import type { RemoteEvent } from '@shared/remote/protocol'
import type {
  DeviceTtlDays,
  RemoteCloudStatus,
  RemoteConnection,
  RemoteDeviceInfo,
  RemotePairRequest,
  RemotePolicyView,
  RemoteState,
  RemoteUnavailableReason
} from '@shared/ipc-remote'
import { DEVICE_TTL_OPTIONS } from '@shared/ipc-remote'
import { applyApproveSetting, type EnableApproveInfo } from './approve-setting'
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
  /** `mode` = `lan` (servidor local en `ip`) o `cloud` (servicio de conexión; `ip` va vacía: no hace falta red local). */
  createTransport: (ip: string, mode?: RemoteConnection) => SignalingTransport
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
  /** Diálogo propio del Mac para ENCENDER «Aprobar comandos desde este celular». Sin él no se puede encender. */
  confirmEnableApprove?: (info: EnableApproveInfo) => Promise<boolean>
  /** ¿Es una lectura? Con el celular bloqueado por inactividad solo se atienden lecturas (sin esto, ninguna). */
  isRead?: (r: CallRequest | HttpRequest) => boolean
  inactivityMs?: number
  /** Motor del protocolo v2 (T4): proxy IPC/HTTP, concentrador de eventos y su búfer. Sin él, toda llamada v2 responde `unavailable`. */
  engine?: RemoteEngineHost
  /** Plataforma sin función (`platform`) o ya conocida como no disponible. */
  unavailable?: () => RemoteUnavailableReason | null
  /** Política de la organización vigente (se consulta en caliente; sin ella, sin restricciones). */
  policy?: () => RemotePolicyView
  /** Vigilancia del sitio (N7): `true` = el sitio no coincide con el manifiesto firmado y el modo nube está EN PAUSA. */
  cloudPaused?: () => boolean
  /** Estado de la vigilancia del sitio para Ajustes. */
  siteCheck?: () => 'ok' | 'mismatch' | 'unknown'
  /** Capacidades que se anuncian a un celular v4 (`caps`); p. ej. `entry` cuando el Mac sabe mandar su lista de archivos. */
  caps?: () => RemoteCap[]
  /** Vigilancia del sitio firmado: se enciende con el modo nube y se apaga con él. */
  siteWatch?: { start(): void; stop(): void }
  /** Archivos de arranque de la interfaz completa con su SRI (versión de ESTE Mac); solo se usa en el modo nube. */
  entry?: () => { v: string; js: string; files: import('@shared/remote/protocol').EntryFile[] } | null
}

/** Tiempo máximo para que una negociación WebRTC termine en un canal con celular autenticado. */
const NEGOTIATION_MS = 25_000
const FLUSH_MS = 250
/** Cada cuánto se relee la política de la organización mientras el control remoto está encendido. */
export const POLICY_POLL_MS = 5000

interface PeerRecord {
  signaling: SignalingPeer
  /** Se crea al llegar la offer (en la nube, cuando ya llegaron los servidores ICE de este celular). */
  answerer: RtcAnswerer | null
  session: PeerSession | null
  dispatch: DeviceDispatch | null
  timer: ReturnType<typeof setTimeout> | null
  kind: 'pair' | 'resume'
  closed: boolean
  /** Solo `pair`: clave del canal (de `pairing.reserve`). */
  pairKey: Uint8Array | null
  /** Solo `pair`: el handshake ya dio su resultado (el QR se consumió o el intento se liberó). */
  pairResolved: boolean
  /** Modo nube: la conexión de este celular pasa por un relé (TURN). */
  relay: boolean
}

export class RemoteService {
  private mode: RemoteState['mode'] = 'off'
  private transport: SignalingTransport | null = null
  private rtc: RtcFactory | null = null
  private ip = ''
  private origin = ''
  /** Modo del transporte en marcha (`lan` o `cloud`). */
  private connMode: RemoteConnection = 'lan'
  /** Nube: sala de este Mac (sha256 de su `hostToken`) y la de vinculación del QR vigente. */
  private roomId = ''
  private pairRoomId: string | null = null
  private pairCode: string | null = null
  private readonly pairing: PairingManager
  private pairingSecret: string | null = null
  private pairingExpired = false
  /** El QR se anuló por demasiados fallos (se explica en Ajustes). */
  private pairingExhausted = false
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
    this.pairing = new PairingManager(d.now, () => this.onPairingExhausted())
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
    const cloud = this.cloudView(policy)
    return {
      available: unavailable === null,
      ...(unavailable ? { unavailable } : {}),
      mode: this.mode,
      pairing: this.mode !== 'off' && this.pairingSecret && this.pairing.active && expiry ? this.pairingView(expiry) : null,
      pairingExpired: this.mode !== 'off' && this.pairingExpired,
      ...(this.mode !== 'off' && this.pairingExhausted ? { pairingExhausted: true } : {}),
      devices,
      pendingPair: this.pending?.req ?? null,
      idleStopAt: this.mode === 'off' ? null : this.idleStopAt,
      error: this.error,
      confirmEachConnection: this.confirmEach(),
      confirmEachForced: policy.requireConnectionConfirm,
      ...(policy.managed ? { policy } : {}),
      ...cloud
    }
  }

  /** Campos de «fuera de casa» del estado (Ajustes). */
  private cloudView(policy: RemotePolicyView): Partial<RemoteState> {
    let prefs: { connection: RemoteConnection; away: boolean } = { connection: 'lan', away: false }
    try {
      prefs = this.d.devices.getCloudPrefs()
    } catch {
      /* sin cifrado: solo red local */
    }
    const blocked = this.outsideBlocked(policy)
    const running = this.mode !== 'off' && this.connMode === 'cloud'
    const paused = running && (this.d.cloudPaused?.() ?? false)
    const status: RemoteCloudStatus | undefined = !running ? undefined : paused ? 'paused' : (this.transport?.status?.() ?? 'connecting')
    return {
      connection: prefs.connection,
      away: prefs.away,
      ...(blocked ? { outsideBlocked: blocked } : {}),
      ...(status ? { cloudStatus: status } : {}),
      ...(running ? { siteCheck: this.d.siteCheck?.() ?? 'unknown' } : {}),
      ...(running && [...this.peers].some((p) => p.relay && p.session === this.connected) ? { relayInUse: true } : {})
    }
  }

  /** Por qué «También fuera de casa» no se puede usar ahora (`null` = se puede). */
  private outsideBlocked(policy: RemotePolicyView): 'policy' | 'passkey-required' | null {
    if (!policy.allowOutsideNetwork) return 'policy'
    // Hasta que existan las passkeys (entrega 2) el modo nube no puede cumplir `requirePasskey`: se queda en la red local.
    if (policy.requirePasskey) return 'passkey-required'
    return null
  }

  /** ¿Hay que usar el servicio de conexión en esta activación? (lo elegido por el dueño, si la política lo permite). */
  private wantCloud(): boolean {
    try {
      return this.d.devices.getCloudPrefs().connection === 'cloud' && this.outsideBlocked(this.pol()) === null
    } catch {
      return false
    }
  }

  private qrCache: { url: string; qr: boolean[][] } | null = null

  private pairingView(expiresAt: number): NonNullable<RemoteState['pairing']> {
    // Nube: el QR lleva el código de 16 caracteres (fragmento `#c=`, que el navegador no envía) y el mismo código se puede escribir.
    const code = this.connMode === 'cloud' && this.pairCode ? formatPairCode(this.pairCode) : null
    const url = code ? `${this.origin}/#c=${code}` : `${this.origin}/#s=${this.pairingSecret}`
    if (this.qrCache?.url !== url) this.qrCache = { url, qr: this.d.qr(url) }
    return { url, qr: this.qrCache.qr, expiresAt, ...(code ? { code } : {}) }
  }

  private changed(): void {
    this.d.onChanged(this.getState())
  }

  // ── ciclo de vida ──

  /** «Activar»: abre el servidor local (o el enlace con el servicio de conexión) y genera el primer QR. */
  start(): Promise<RemoteState> {
    if (this.mode !== 'off') return Promise.resolve(this.getState())
    this.starting ??= this.doStart(false).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  /**
   * Al abrir la app con «Disponible fuera de casa»: enciende el servicio SIN QR (solo reconexiones de los celulares ya
   * vinculados). No hace nada si no está elegido el modo nube, si no hay celulares o si la política no lo permite.
   */
  autoStartAway(): Promise<RemoteState> {
    if (this.mode !== 'off') return Promise.resolve(this.getState())
    let ok = false
    try {
      ok = this.d.devices.getCloudPrefs().away && this.wantCloud() && this.d.devices.list().length > 0
    } catch {
      ok = false
    }
    if (!ok) return Promise.resolve(this.getState())
    this.starting ??= this.doStart(true).finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async doStart(quiet: boolean): Promise<RemoteState> {
    this.error = null
    const unavailable = this.unavailableReason()
    if (unavailable) {
      this.changed()
      return this.getState()
    }
    const cloud = this.wantCloud()
    // En la nube no hace falta red local ni IP privada: el Mac sale hacia fuera. En la red local, sí.
    const ip = cloud ? '' : this.d.getLanIp()
    if (ip === null) {
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
    const transport = this.d.createTransport(ip, cloud ? 'cloud' : 'lan')
    transport.onPeer((p) => this.handlePeer(p))
    transport.onStatus?.(() => this.changed())
    this.connMode = cloud ? 'cloud' : 'lan'
    try {
      if (cloud) {
        const token = this.d.devices.hostToken()
        if (!token) throw new Error('no-safe-storage')
        this.roomId = roomOfToken(token)
      }
      const { origin } = await transport.start({
        authorize: (h, room) => this.authorize(h, room),
        allowRelay: () => this.pol().allowRelay
      })
      this.origin = origin
    } catch (err) {
      this.connMode = 'lan'
      this.roomId = ''
      await transport.stop().catch(() => undefined)
      this.error = err instanceof Error ? err.message : String(err)
      this.changed()
      return this.getState()
    }
    this.rtc = rtc
    this.ip = ip
    this.transport = transport
    if (cloud) {
      this.d.audit?.({ kind: 'cloud-started' })
      this.d.siteWatch?.start()
    }
    // Política sin «recordar»: los vínculos no sobreviven entre activaciones (se borran los que quedaran de antes).
    if (!this.pol().allowRemember) this.purgeDevices()
    if (quiet) this.mode = 'active'
    else {
      this.mode = 'pairing'
      this.newPairingToken()
    }
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
      void this.shutdown()
      return
    }
    // La política cerró «fuera de casa» con el modo nube en marcha: se corta el socket saliente al instante.
    if (this.mode !== 'off' && this.connMode === 'cloud' && this.outsideBlocked(p)) {
      this.d.audit?.({ kind: 'policy-blocked' })
      void this.shutdown()
      return
    }
    if (this.mode !== 'off' && this.connMode === 'cloud') this.transport?.recheck?.()
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
    let token
    if (this.connMode === 'cloud') {
      // Código escribible de 16 caracteres (80 bits): de él sale `q`, y de `q` el token de la sala de vinculación (el servicio
      // no ve `q`). El QR lleva el mismo código.
      const code = encodePairCode(new Uint8Array(randomBytes(10)))
      const q = pairSecretFromCode(code) as string
      token = this.pairing.create(q)
      this.pairCode = code
      this.pairRoomId = pairRoom(q)
      this.transport?.setPairRoom?.(pairHostToken(q))
    } else token = this.pairing.create()
    this.pairingSecret = token.secret
    this.pairingExpired = false
    this.pairingExhausted = false
    this.mode = this.mode === 'off' ? 'off' : 'pairing'
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = setTimeout(() => this.onPairingExpired(), Math.max(0, token.expiresAt - this.now()) + 20)
  }

  /** La sala de vinculación deja de existir en cuanto el QR deja de valer (caduca, se usa, se anula o se corta todo). */
  private closePairRoom(): void {
    this.pairCode = null
    this.pairRoomId = null
    this.transport?.setPairRoom?.(null)
  }

  private onPairingExpired(): void {
    this.pairingTimer = null
    if (this.mode === 'off') return
    if (this.pairingSecret && !this.pairing.active) {
      this.closePairRoom()
      this.pairingSecret = null
      this.pairingExpired = true
      this.mode = 'active'
      this.changed()
    }
  }

  /** 5 fallos de vinculación: el QR se anuló (el dueño genera otro). */
  private onPairingExhausted(): void {
    if (this.mode === 'off') return
    this.closePairRoom()
    this.pairingSecret = null
    this.pairingExpired = false
    this.pairingExhausted = true
    this.mode = 'active'
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = null
    this.changed()
  }

  /**
   * «Cortar todo» (acción del dueño): cierra conexiones, servidor y anula el QR, y apaga «Disponible fuera de casa» (se vuelve a
   * encender a mano). Los cierres que no son una decisión del dueño (política, inactividad, salir de la app) usan `shutdown()`.
   */
  async stopAll(): Promise<RemoteState> {
    try {
      if (this.d.devices.getCloudPrefs().away) this.d.audit?.({ kind: 'away-disabled' })
      this.d.devices.setCloudPrefs({ away: false })
    } catch {
      /* sin cifrado no hay nada guardado */
    }
    return this.shutdown()
  }

  private async shutdown(): Promise<RemoteState> {
    const wasOff = this.mode === 'off' && !this.transport
    this.mode = 'off'
    this.pairing.revoke()
    this.closePairRoom()
    this.pairingSecret = null
    this.pairingExpired = false
    this.pairingExhausted = false
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = null
    // H6: «Cortar todo» borra también «Recordar 12 h» y la actividad reciente (si no, reactivar el mismo día reconectaría sin pedir nada).
    this.lastActive.clear()
    try {
      this.d.devices.clearAllTrust()
      // «Cortar todo» también apaga «Aprobar comandos desde este celular» (se vuelve a encender, con confirmación, si se quiere).
      for (const id of this.d.devices.clearAllApprove()) {
        const rec = this.d.devices.get(id)
        this.d.audit?.({ kind: 'approve-disabled', device: deviceFingerprint(id), ...(rec ? { name: rec.name } : {}) })
      }
    } catch {
      /* sin cifrado no hay nada guardado */
    }
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
    this.connMode = 'lan'
    this.roomId = ''
    this.d.siteWatch?.stop()
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
    await this.shutdown()
    this.rtc = null
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = null
    this.idleStopAt = null
    if (this.mode === 'off' || this.connected) return
    // «Disponible fuera de casa»: el enlace con el servicio queda encendido (sin apagado por inactividad) mientras haya celulares.
    if (this.connMode === 'cloud' && this.awayOn() && this.d.devices.list().length > 0) return
    this.idleStopAt = this.now() + LIMITS.idleShutdownMs
    this.idleTimer = setTimeout(() => void this.shutdown(), LIMITS.idleShutdownMs)
  }

  // ── señalización ──

  private authorize(h: SignalHello, room?: string): boolean {
    this.applyPolicy()
    if (this.mode === 'off') return false
    if (this.connMode === 'cloud') {
      // El sitio no coincide con el manifiesto firmado, o la política lo cerró: el modo nube NO acepta a nadie.
      if (this.d.cloudPaused?.() || this.outsideBlocked(this.pol())) return false
      // Cada `hello` solo vale por SU sala: reanudar por la sala de vinculación (o vincular por la del Mac) se rechaza.
      if (h.mode === 'pair') return room === this.pairRoomId && !this.pairing.reserved && this.pairing.match(h.qid)
      return room === this.roomId && this.d.devices.get(h.deviceId) !== null
    }
    // Reconocer el `qid` NO consume el QR (un `qid` ajeno suma un fallo; 5 lo anulan). Con un intento ya en curso no hay otro.
    if (h.mode === 'pair') return !this.pairing.reserved && this.pairing.match(h.qid)
    return this.d.devices.get(h.deviceId) !== null
  }

  private handlePeer(sp: SignalingPeer): void {
    if (this.mode === 'off' || !this.rtc) return sp.close()
    const hello = sp.hello
    let pairKey: Uint8Array | null = null
    if (hello.mode === 'pair') {
      // El QR NO se anula aquí: solo un `hs3` correcto lo consume (un `hello` con `qid` válido no basta para quemarlo).
      if (this.pending || [...this.peers].some((p) => p.kind === 'pair')) return sp.close()
      if (this.peers.size >= LIMITS.maxSignalSockets) return sp.close()
      pairKey = this.pairing.reserve(hello.qid)
      if (!pairKey) return sp.close()
    } else if (this.peers.size >= LIMITS.maxSignalSockets) return sp.close()
    // Nube: el `hello` solo vale por su sala (el transporte ya lo comprobó con `authorize`; esto es defensa en profundidad).
    if (this.connMode === 'cloud' && sp.room !== (hello.mode === 'pair' ? this.pairRoomId : this.roomId)) return sp.close()

    const rtc = this.rtc
    const rec: PeerRecord = {
      signaling: sp,
      answerer: null,
      session: null,
      dispatch: null,
      timer: null,
      kind: hello.mode,
      closed: false,
      pairKey,
      pairResolved: false,
      relay: false
    }
    this.peers.add(rec)
    rec.timer = setTimeout(() => {
      if (!rec.session?.authed) this.closePeer(rec)
    }, NEGOTIATION_MS)

    let offerSdp = ''
    let answerSdp = ''
    // Solo la PRIMERA offer y la PRIMERA answer: las huellas del handshake salen de ellas y no pueden cambiar a mitad.
    sp.onOffer((sdp) => {
      if (offerSdp || rec.closed) return
      offerSdp = sdp
      // El respondedor se crea AL LLEGAR LA OFFER: en la nube ya llegaron los servidores ICE de este celular (`turn` va antes de
      // `ready`). Nube: STUN siempre (+ TURN si lo repartió el servicio); red local: ninguno.
      const iceServers: IceServerSpec[] = this.connMode === 'cloud' ? [{ urls: [CLOUD_STUN_URL] }, ...(sp.iceServers?.() ?? [])] : []
      const answerer = rtc.createAnswerer({ ...(this.connMode === 'cloud' ? {} : { bindAddress: this.ip }), iceServers })
      rec.answerer = answerer
      this.wireAnswerer(
        rec,
        sp,
        answerer,
        () => ({ offerSdp, answerSdp }),
        (sdp) => (answerSdp = sdp),
        hello
      )
      answerer.start(sdp)
    })
    sp.onIce((c, mid) => rec.answerer?.addRemoteCandidate(c, mid))
    sp.onClose(() => {
      // Si el canal aún no existe, no hay nada que esperar.
      if (!rec.session && !rec.closed) this.closePeer(rec)
    })
  }

  private wireAnswerer(
    rec: PeerRecord,
    sp: SignalingPeer,
    answerer: RtcAnswerer,
    sdps: () => { offerSdp: string; answerSdp: string },
    setAnswer: (sdp: string) => void,
    hello: SignalHello
  ): void {
    answerer.onAnswer((sdp) => {
      if (sdps().answerSdp) return
      setAnswer(sdp)
      sp.sendAnswer(sdp)
    })
    answerer.onCandidate((c, mid) => sp.sendIce(c, mid))
    answerer.onGone(() => this.closePeer(rec, true))
    answerer.onChannel((channel) => {
      const { offerSdp, answerSdp } = sdps()
      if (rec.session || rec.closed) return channel.close()
      // Huellas ESTRICTAS (una sola, sha-256) de los dos SDP: lo que la pila DTLS verificó contra los certificados.
      const fo = offerSdp ? sdpFingerprintStrict(offerSdp) : null
      const fa = answerSdp ? sdpFingerprintStrict(answerSdp) : null
      const fps = fo && fa ? { offer: fo, answer: fa } : null
      const session: PeerSession = new PeerSession({
        channel,
        kind: hello.mode,
        deviceName: hello.mode === 'pair' ? hello.deviceName : undefined,
        deviceId: hello.mode === 'resume' ? hello.deviceId : undefined,
        fps,
        qid: hello.mode === 'pair' ? hello.qid : undefined,
        pairKey: rec.pairKey ?? undefined,
        onPairProof: (ok) => this.onPairProof(rec, ok),
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
        limits: () => ({ capDays: this.pol().deviceTtlDays, maxDevices: this.pol().maxDevices }),
        // `caps` y `entry` solo existen en el modo nube: en la red local la PWA se sirve desde el propio Mac (misma versión).
        caps: () => (this.connMode === 'cloud' ? (this.d.caps?.() ?? []) : []),
        entry: this.connMode === 'cloud' ? this.d.entry : undefined,
        room: () => (this.connMode === 'cloud' ? this.roomId : undefined)
      })
      rec.session = session
      channel.onOpen(() => {
        session.start()
        // ¿Vía relé? (solo informativo, para Ajustes; la pila puede no saberlo todavía).
        rec.relay = this.connMode === 'cloud' && answerer.selectedType?.() === 'relay'
        // El canal ya está abierto: la señalización no hace falta más (libera un socket).
        sp.close()
      })
    })
  }

  /** Resultado del handshake de una vinculación: `hs3` correcto consume el QR; si no, se libera el intento y cuenta un fallo. */
  private onPairProof(rec: PeerRecord, ok: boolean): boolean {
    if (rec.pairResolved) return false
    rec.pairResolved = true
    if (!ok) {
      this.pairing.release(true)
      return false
    }
    if (!this.pairing.consume()) return false
    this.closePairRoom()
    this.pairingSecret = null
    this.pairingExpired = false
    this.mode = 'active'
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = null
    this.changed()
    return true
  }

  /** Cierra la negociación/conexión. Salvo `immediate`, da tiempo a que salga la última trama (`bye`). */
  private closePeer(rec: PeerRecord, immediate = false): void {
    if (rec.closed) return
    rec.closed = true
    if (rec.timer) clearTimeout(rec.timer)
    rec.timer = null
    this.peers.delete(rec)
    // Vinculación abandonada sin resultado: se libera el intento. Cuenta como fallo solo si el canal llegó a abrirse.
    if (rec.kind === 'pair' && !rec.pairResolved) {
      rec.pairResolved = true
      this.pairing.release(rec.session?.started === true)
    }
    try {
      rec.signaling.close()
    } catch {
      /* ya cerrado */
    }
    rec.session?.close('closed')
    const answerer = rec.answerer
    if (!answerer) return
    if (immediate) answerer.close()
    else setTimeout(() => answerer.close(), FLUSH_MS + 100).unref()
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
    this.lastActive.clear()
    this.d.audit?.({ kind: 'revoked-all', n: all.length })
    if (this.connected) this.connected.bye('revoked')
    for (const p of [...this.peers]) p.session?.bye('revoked')
    this.d.devices.revokeAll()
    // Nube: la sala de este Mac cambió (el `hostToken` se renueva al quitar a todos): se reabre con la nueva.
    if (this.connMode === 'cloud') void this.rekeyCloud()
    this.changed()
    return this.getState()
  }

  /** Reabre el enlace con el servicio con el `hostToken` vigente (tras renovarlo). */
  private async rekeyCloud(): Promise<void> {
    const transport = this.transport
    if (!transport || this.mode === 'off') return
    const token = this.d.devices.hostToken()
    if (!token) return
    await transport.stop().catch(() => undefined)
    if (this.transport !== transport) return
    this.roomId = roomOfToken(token)
    try {
      await transport.start({ authorize: (h, room) => this.authorize(h, room), allowRelay: () => this.pol().allowRelay })
      if (this.pairingSecret && this.pairing.active) this.transport?.setPairRoom?.(this.currentPairToken())
    } catch {
      /* el estado del enlace quedará `offline`; el dueño puede reactivar */
    }
    this.changed()
  }

  private currentPairToken(): string | null {
    return this.pairingSecret ? pairHostToken(this.pairingSecret) : null
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
      // Un celular ya vinculado con PIN solo confirma en el Mac si el ajuste (o la política) lo pide. Sin PIN SIEMPRE confirma:
      // si no, un secreto robado de un vínculo sin PIN (antiguo, o tras «Restablecer PIN») bastaría para fijar un PIN nuevo y entrar.
      needsConfirm: (id) => this.confirmEach() || !this.d.devices.hasPin(id),
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

  /** ¿Se confirma en el Mac cada conexión de un celular ya vinculado? Política (endurece) o ajuste del usuario; apagado por defecto. */
  private confirmEach(): boolean {
    if (this.pol().requireConnectionConfirm) return true
    try {
      return this.d.devices.getPrefs().confirmEachConnection
    } catch {
      return true // fail-closed: si no se puede leer el ajuste, se pregunta
    }
  }

  /** «Pedir confirmación en el Mac en cada conexión». Ignorado si la política lo fuerza. Apagarlo borra «Recordar 12 h». */
  setConfirmEach(on: boolean): RemoteState {
    if (!this.pol().requireConnectionConfirm) {
      try {
        this.d.devices.setPrefs({ confirmEachConnection: on })
        if (!on) this.d.devices.clearAllTrust()
      } catch {
        /* sin cifrado no se guarda */
      }
    }
    this.changed()
    return this.getState()
  }

  /** «Aprobar comandos desde este celular»: encender pide confirmar en el Mac (diálogo propio); apagar es inmediato. */
  async setApproveCommands(deviceId: string, on: boolean): Promise<RemoteState> {
    await applyApproveSetting({ devices: this.d.devices, audit: this.d.audit, confirmEnable: this.d.confirmEnableApprove }, deviceId, on)
    this.changed()
    return this.getState()
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

  // ── fuera de casa ──

  private awayOn(): boolean {
    try {
      return this.d.devices.getCloudPrefs().away
    } catch {
      return false
    }
  }

  /**
   * «Solo esta red» / «También fuera de casa». Con el servicio en marcha se reinicia con el modo nuevo (se pierden el QR vigente
   * y la conexión actual); apagado, solo se guarda la elección. La política manda: sin permiso, `cloud` no se activa.
   */
  async setConnection(connection: RemoteConnection): Promise<RemoteState> {
    try {
      if (this.d.devices.getCloudPrefs().connection !== connection) this.d.audit?.({ kind: 'connection-changed', why: connection })
      this.d.devices.setCloudPrefs({ connection })
    } catch {
      /* sin cifrado no se guarda */
    }
    if (this.mode !== 'off') {
      const wasQuiet = this.mode === 'active' && !this.pairingSecret
      await this.shutdown()
      if (connection === 'lan' || this.outsideBlocked(this.pol()) === null) await (wasQuiet ? this.autoStartAway() : this.start())
    } else this.changed()
    return this.getState()
  }

  /** «Disponible fuera de casa»: encender arranca el servicio ya (si hay celulares); apagar vuelve al apagado por inactividad. */
  async setAway(on: boolean): Promise<RemoteState> {
    try {
      if (this.d.devices.getCloudPrefs().away !== on) this.d.audit?.({ kind: on ? 'away-enabled' : 'away-disabled' })
      this.d.devices.setCloudPrefs({ away: on })
    } catch {
      /* sin cifrado no se guarda */
    }
    if (on && this.mode === 'off') return this.autoStartAway()
    if (this.mode !== 'off') {
      this.armIdleTimer()
      this.changed()
    }
    return this.getState()
  }

  /** ¿El servicio está en marcha con el servicio de conexión (modo nube)? */
  isCloudRunning(): boolean {
    return this.mode !== 'off' && this.connMode === 'cloud'
  }

  /** La vigilancia del sitio cambió de estado: se cierra o reabre el enlace con el servicio y se refresca Ajustes. */
  onSiteChange(): void {
    if (this.mode === 'off' || this.connMode !== 'cloud') return
    this.transport?.recheck?.()
    this.changed()
  }

  /** El Mac se va a dormir (`true`) o despertó (`false`): el socket saliente se cierra/reabre al instante. */
  onPower(suspended: boolean): void {
    if (this.mode === 'off' || this.connMode !== 'cloud') return
    if (suspended) this.transport?.suspend?.()
    else this.transport?.resume?.()
    this.changed()
  }

  /** Cambió la red del Mac: los sockets viejos pueden estar muertos. */
  onNetworkChange(): void {
    if (this.mode === 'off' || this.connMode !== 'cloud') return
    this.transport?.networkChanged?.()
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
