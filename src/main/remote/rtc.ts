/**
 * Envoltorio mínimo de `node-datachannel` (libdatachannel): el escritorio hace de RESPONDEDOR WebRTC (el celular
 * crea la oferta y el DataChannel). Solo candidatos locales: sin servidores STUN/TURN y ligado a la IPv4 privada.
 * `node-datachannel` se carga con `import()` la primera vez (nada de esto existe mientras la función está apagada).
 */
import { LIMITS } from '@shared/remote/protocol'

export interface RtcChannel {
  send(text: string): void
  close(): void
  isOpen(): boolean
  onOpen(cb: () => void): void
  /** `raw` puede ser texto o binario: quien valida (`parseClientFrame`) rechaza lo que no sea texto. */
  onMessage(cb: (raw: unknown) => void): void
  onClose(cb: () => void): void
  /** Bytes en el búfer de salida del canal (control de flujo del multiplexor). */
  bufferedAmount?(): number
  setBufferedAmountLowThreshold?(bytes: number): void
  /** Se llama cuando `bufferedAmount` baja del umbral fijado. */
  onBufferedAmountLow?(cb: () => void): void
}

export interface RtcAnswerer {
  /** Aplica la oferta; el SDP de respuesta llega por `onAnswer`. */
  start(offerSdp: string): void
  onAnswer(cb: (sdp: string) => void): void
  onCandidate(cb: (candidate: string, mid: string) => void): void
  onChannel(cb: (channel: RtcChannel) => void): void
  /** La conexión falló o se cerró. */
  onGone(cb: () => void): void
  addRemoteCandidate(candidate: string, mid: string): void
  close(): void
}

export interface RtcFactory {
  createAnswerer(opts: { bindAddress: string }): RtcAnswerer
}

type NdcModule = typeof import('node-datachannel')

let loaded: Promise<NdcModule> | null = null

function loadModule(): Promise<NdcModule> {
  loaded ??= import('node-datachannel').then((m) => {
    const mod = m as unknown as { default?: NdcModule } & NdcModule
    return mod.PeerConnection ? mod : (mod.default as NdcModule)
  })
  return loaded
}

/** Carga la librería nativa (lanza si el binario no está o no es válido). */
export async function loadRtc(): Promise<RtcFactory> {
  const ndc = await loadModule()
  if (typeof ndc.PeerConnection !== 'function') throw new Error('node-datachannel no expone PeerConnection')
  let counter = 0
  return {
    createAnswerer({ bindAddress }) {
      const pc = new ndc.PeerConnection(`onyx-${++counter}`, {
        iceServers: [],
        bindAddress,
        enableIceTcp: false,
        maxMessageSize: LIMITS.maxFrameBytes
      })
      let closed = false
      const gone: Array<() => void> = []
      const fireGone = (): void => {
        for (const cb of gone) cb()
      }
      pc.onStateChange((state) => {
        if (state === 'failed' || state === 'closed' || state === 'disconnected') fireGone()
      })
      return {
        start: (offer) => pc.setRemoteDescription(offer, 'offer'),
        onAnswer: (cb) => pc.onLocalDescription((sdp, type) => type === 'answer' && cb(sdp)),
        onCandidate: (cb) => pc.onLocalCandidate((c, mid) => cb(c, mid)),
        onChannel: (cb) =>
          pc.onDataChannel((dc) => {
            cb({
              send: (text) => {
                try {
                  dc.sendMessage(text)
                } catch {
                  /* el celular ya se fue: el cierre llega por onClose */
                }
              },
              close: () => {
                try {
                  dc.close()
                } catch {
                  /* ya cerrado */
                }
              },
              isOpen: () => dc.isOpen(),
              onOpen: (f) => {
                dc.onOpen(f)
                // El canal puede llegar ya abierto.
                if (dc.isOpen()) queueMicrotask(f)
              },
              onMessage: (f) => dc.onMessage((m) => f(m)),
              onClose: (f) => dc.onClosed(f),
              bufferedAmount: () => {
                try {
                  return dc.bufferedAmount()
                } catch {
                  return 0
                }
              },
              setBufferedAmountLowThreshold: (n) => {
                try {
                  dc.setBufferedAmountLowThreshold(n)
                } catch {
                  /* canal cerrado */
                }
              },
              onBufferedAmountLow: (f) => dc.onBufferedAmountLow(f)
            })
          }),
        onGone: (cb) => void gone.push(cb),
        addRemoteCandidate: (c, mid) => {
          try {
            pc.addRemoteCandidate(c, mid)
          } catch {
            /* candidato mal formado: se ignora */
          }
        },
        close: () => {
          if (closed) return
          closed = true
          try {
            pc.close()
          } catch {
            /* ya cerrado */
          }
        }
      }
    }
  }
}
