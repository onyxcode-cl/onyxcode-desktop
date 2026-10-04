/**
 * Lógica COMÚN de una sesión de señalización (un celular), la usan los dos transportes: el servidor local (`lan-server.ts`) y el
 * cliente del servicio de conexión (`worker-client.ts`). Aquí vive lo que no depende de cómo llegan las tramas:
 *  - plazo para el `hello` (5 s) y rechazo de binarios o tramas inválidas,
 *  - comprobación de versión (v3 y v4; una pestaña de una versión anterior ve «versión», no «trama inválida»),
 *  - `authorize` (que solo conoce `qid` o el dispositivo: nunca un secreto) y respuesta `ready`,
 *  - una sola `offer`, ICE solo después de ella y con tope.
 * Comportamiento idéntico al de antes de extraerlo: las pruebas de `lan-server*.test.ts` siguen valiendo.
 */
import { LIMITS, encodeFrame, parseSignalClientFrame, protocolVersionOk } from '@shared/remote/protocol'
import type { IceServerSpec, SignalErrorCode, SignalHostFrame } from '@shared/remote/protocol'
import type { SignalHello, SignalingPeer } from './types'

export const HELLO_TIMEOUT_MS = 5_000
export const MAX_ICE_FRAMES = 60

export interface SessionIo {
  /** Entrega una trama (texto JSON) al celular. */
  send(text: string): void
  /** Cierra el enlace con el celular (`code` solo informativo). */
  close(code?: number): void
}

export interface SessionOptions {
  io: SessionIo
  /** ¿Es válido el `hello`? Sin secretos. La sala (nube) la pone el transporte. */
  authorize(hello: SignalHello, room?: string): boolean
  /** Hay un celular autorizado: el servicio le da paso (siempre DESPUÉS de enviar `ready`). */
  onPeer(peer: SignalingPeer): void
  /** Sala por la que llegó (nube). */
  room?: string
  /** Nube: se llama justo antes de `ready`, con el `hello` ya aceptado (aquí el transporte manda `grant`). */
  beforeReady?(hello: SignalHello): void
  /** Nube: servidores ICE de ESTE celular (llegan con `turn` antes de la oferta). */
  iceServers?(): IceServerSpec[]
  /** Nube: `kick` al cerrar desde el Mac. */
  onClosedByHost?(): void
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (h: ReturnType<typeof setTimeout>) => void
}

/** ¿Es un `hello` cuyo `v` numérico no es de un protocolo que se atiende? (lectura laxa: distingue «versión» de «trama inválida»). */
function helloVersionMismatch(raw: string): boolean {
  if (raw.length > LIMITS.maxSignalFrameBytes) return false
  try {
    const o = JSON.parse(raw) as { t?: unknown; v?: unknown }
    return !!o && typeof o === 'object' && o.t === 'hello' && typeof o.v === 'number' && !protocolVersionOk(o.v)
  } catch {
    return false
  }
}

export class SignalSession {
  private hello: SignalHello | null = null
  private offered = false
  private iceCount = 0
  private closed = false
  private offerCb: ((sdp: string) => void) | null = null
  private iceCb: ((c: string, mid: string) => void) | null = null
  private closeCb: (() => void) | null = null
  private readonly timer: ReturnType<typeof setTimeout>
  private readonly clear: (h: ReturnType<typeof setTimeout>) => void
  readonly peer: SignalingPeer

  constructor(private readonly o: SessionOptions) {
    const set = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
    this.clear = o.clearTimer ?? ((h) => clearTimeout(h))
    this.timer = set(() => {
      if (!this.hello) this.shut(1008)
    }, HELLO_TIMEOUT_MS)
    const currentHello = (): SignalHello => this.hello as SignalHello
    this.peer = {
      get hello() {
        return currentHello()
      },
      ...(o.room !== undefined ? { room: o.room } : {}),
      ...(o.iceServers ? { iceServers: () => o.iceServers!() } : {}),
      sendAnswer: (sdp) => this.send({ t: 'answer', sdp }),
      sendIce: (candidate, mid) => this.send({ t: 'ice', candidate, mid }),
      onOffer: (cb) => void (this.offerCb = cb),
      onIce: (cb) => void (this.iceCb = cb),
      onClose: (cb) => void (this.closeCb = cb),
      close: () => {
        // Lo cierra el Mac (el servicio ya lo sabe): no se avisa de vuelta, solo se libera el enlace.
        this.o.onClosedByHost?.()
        this.shut(1000, false)
      }
    }
  }

  private send(f: SignalHostFrame): void {
    const s = encodeFrame(f)
    if (s && !this.closed) this.o.io.send(s)
  }

  private fail(code: SignalErrorCode): void {
    this.send({ t: 'error', code })
    this.shut(1008)
  }

  private shut(code: number, notify = true): void {
    if (this.closed) return
    this.closed = true
    this.clear(this.timer)
    try {
      this.o.io.close(code)
    } catch {
      /* ya cerrado */
    }
    if (notify && this.hello) this.closeCb?.()
  }

  /** Una trama del celular. `binary`: llegó como binario (no se admite). */
  receive(raw: string, binary = false): void {
    if (this.closed) return
    if (binary) return this.fail('frame')
    // Una pestaña de una versión anterior (otra forma de `hello`, p. ej. con `secret`) debe ver «versión», no «trama inválida».
    if (!this.hello && helloVersionMismatch(raw)) return this.fail('version')
    const parsed = parseSignalClientFrame(raw)
    if (!parsed.ok) return this.fail('frame')
    const f = parsed.value
    if (!this.hello) {
      if (f.t !== 'hello') return this.fail('frame')
      if (!protocolVersionOk(f.v)) return this.fail('version')
      // `authorize` solo reconoce el `qid` o el dispositivo (sin secretos); cuenta los fallos de un QR.
      let ok = false
      try {
        ok = this.o.authorize(f, this.o.room)
      } catch {
        ok = false
      }
      if (!ok) return this.fail('invalid')
      this.hello = f
      this.clear(this.timer)
      this.o.beforeReady?.(f)
      this.send({ t: 'ready' })
      this.o.onPeer(this.peer)
      return
    }
    if (f.t === 'offer' && !this.offered) {
      this.offered = true
      this.offerCb?.(f.sdp)
    } else if (f.t === 'ice' && this.offered && this.iceCount++ < MAX_ICE_FRAMES) {
      this.iceCb?.(f.candidate, f.mid)
    } else {
      this.fail('frame')
    }
  }

  /** El celular se fue (o el enlace se cayó). */
  gone(): void {
    if (this.closed && !this.hello) return
    this.shut(1000)
  }
}
