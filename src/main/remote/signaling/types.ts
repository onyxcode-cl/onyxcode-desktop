/**
 * Interfaz intercambiable de señalización (SDP/ICE). La implementan el servidor HTTP+WebSocket local (`lan-server.ts`, modo
 * «Solo esta red») y el cliente del servicio de conexión (`worker-client.ts`, modo «También fuera de casa»). Los campos
 * opcionales solo existen en el segundo.
 */
import type { IceServerSpec, SignalClientFrame } from '@shared/remote/protocol'

export type { IceServerSpec }

export type SignalHello = Extract<SignalClientFrame, { t: 'hello' }>

/** Un celular que ya pasó el `hello` (autorizado) y negocia la conexión WebRTC. */
export interface SignalingPeer {
  readonly hello: SignalHello
  /** Nube: sala por la que llegó (el Mac comprueba que casa con el modo: `hello` resume = su sala; pair = la de vinculación). */
  readonly room?: string
  /** Nube: servidores ICE de ESTE celular (llegan con `turn` antes de la offer). LAN: ausente = ninguno. */
  iceServers?(): IceServerSpec[]
  sendAnswer(sdp: string): void
  sendIce(candidate: string, mid: string): void
  /** Una sola oferta por peer. */
  onOffer(cb: (sdp: string) => void): void
  onIce(cb: (candidate: string, mid: string) => void): void
  onClose(cb: () => void): void
  close(): void
}

export interface SignalingStartOptions {
  /**
   * Decide si el `hello` es válido: reconoce el `qid` de un QR vigente (NO lo consume: un `qid` ajeno suma un fallo al QR) o el
   * dispositivo. Nunca recibe un secreto: `q` y el secreto de dispositivo no salen del celular.
   */
  authorize(hello: SignalHello, room?: string): boolean
  /** Nube: ¿se puede conceder relé (TURN) a este celular? Política `allowRelay`. Sin esto, sí. */
  allowRelay?(): boolean
}

export interface SignalingTransport {
  /** Abre el servicio y devuelve el origen público para armar el QR (LAN: `http://ip:puerto`; nube: `https://remoto.onyxcode.cl`). */
  start(opts: SignalingStartOptions): Promise<{ origin: string }>
  onPeer(cb: (peer: SignalingPeer) => void): void
  /** Cierra todo (sockets y puerto). Idempotente. */
  stop(): Promise<void>
  /** Nube: abre (con el token) o cierra (`null`) la sala de vinculación del QR vigente. LAN: no existe. */
  setPairRoom?(hostToken: string | null): void
  /** Estado del enlace con el servicio, para Ajustes. LAN: siempre `online`. */
  status?(): TransportStatus
  onStatus?(cb: (s: TransportStatus) => void): void
  /** Nube: el Mac se duerme (cerrar ya), despertó (reconectar ya) o cambió la red; y «¿se sigue permitiendo?». */
  suspend?(): void
  resume?(): void
  networkChanged?(): void
  recheck?(): void
  /** Modo viaje: `T` de la puerta del túnel (va en la ruta del QR `/k/<T>`); `null` si no hay túnel abierto. */
  travelToken?(): string | null
  /** Modo viaje: fase del túnel (`starting`, `checking`, `online`, `connecting`, `retrying`, `failed`). */
  phase?(): 'idle' | 'starting' | 'checking' | 'online' | 'connecting' | 'retrying' | 'failed'
  /** Modo viaje: el túnel se relanzó con OTRO nombre (el origen cambió; los vínculos del túnel anterior ya no sirven). */
  onRestart?(cb: (origin: string) => void): void
  /** Modo viaje: se rindió tras varias caídas seguidas (código de error para Ajustes). */
  onFail?(cb: (error: string) => void): void
  /** Modo viaje: el último error del túnel. */
  lastError?(): string | null
  /** Síncrono: mata el proceso del túnel sin esperar (salir de la app). */
  killNow?(): void
}

export type TransportStatus = 'connecting' | 'online' | 'offline'
