/**
 * Interfaz intercambiable de señalización (SDP/ICE). El prototipo la implementa con un servidor HTTP+WebSocket
 * local (`lan-server.ts`); la fase 2 la sustituirá por un Worker de Cloudflare sin estado sin tocar el resto.
 */
import type { SignalClientFrame } from '@shared/remote/protocol'

export type SignalHello = Extract<SignalClientFrame, { t: 'hello' }>

/** Un celular que ya pasó el `hello` (autorizado) y negocia la conexión WebRTC. */
export interface SignalingPeer {
  readonly hello: SignalHello
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
  authorize(hello: SignalHello): boolean
}

export interface SignalingTransport {
  /** Abre el servicio y devuelve el origen público (`http://ip:puerto`) para armar el QR. */
  start(opts: SignalingStartOptions): Promise<{ origin: string }>
  onPeer(cb: (peer: SignalingPeer) => void): void
  /** Cierra todo (sockets y puerto). Idempotente. */
  stop(): Promise<void>
}
