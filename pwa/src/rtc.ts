/**
 * Enlace con el Mac: señalización por WebSocket (`/ws`) + RTCDataChannel `onyx`. El celular es quien ofrece (offer) y quien
 * crea el canal, DESPUÉS de recibir `ready`. Sin servidores STUN/TURN (solo red local). No usa `crypto.subtle` ni nada que
 * exija contexto seguro. Todo lo recibido por señalización se valida con los validadores compartidos.
 */
import { BUFFER } from '../../src/shared/remote/mux'
import {
  DATACHANNEL_LABEL,
  LIMITS,
  SIGNALING_PATH,
  encodeFrame,
  parseSignalHostFrame,
  type SignalClientFrame,
  type SignalErrorCode
} from '../../src/shared/remote/protocol'

/** Plazo para que el servidor responda `ready` (WebSocket abierto + hello válido). */
export const READY_TIMEOUT_MS = 8_000
/** Plazo desde la respuesta hasta que el canal abre (aislamiento de clientes, firewall…). */
export const CHANNEL_TIMEOUT_MS = 15_000
const DISCONNECTED_GRACE_MS = 6_000
const MAX_ICE_SENT = 50

export type LinkEnd =
  /** No se llegó al equipo (sin `ready` o sin canal a tiempo). */
  { k: 'no-host' } | { k: 'signal-error'; code: SignalErrorCode } | { k: 'closed' } | { k: 'unsupported' }

export interface LinkHandlers {
  /** El canal abrió; trae los SDP de ambos lados para calcular el código de 6 dígitos. */
  onOpen(info: { offerSdp: string; answerSdp: string }): void
  onMessage(raw: string): void
  /** `bufferedAmount` bajó de `BUFFER.low` (control de flujo del multiplexor). */
  onDrain?(): void
  /** Se llama UNA vez cuando el enlace termina (antes o después de abrir). */
  onEnd(why: LinkEnd): void
}

export interface Link {
  /** `false` si el canal no está abierto o la trama no cabe. */
  send(text: string): boolean
  isOpen(): boolean
  /** Bytes pendientes en el búfer de salida del canal. */
  bufferedAmount(): number
  close(): void
}

export function webrtcSupported(): boolean {
  return typeof RTCPeerConnection === 'function' && typeof WebSocket === 'function'
}

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${SIGNALING_PATH}`
}

export function openLink(hello: Extract<SignalClientFrame, { t: 'hello' }>, h: LinkHandlers): Link {
  let ended = false
  let ws: WebSocket | null = null
  let pc: RTCPeerConnection | null = null
  let dc: RTCDataChannel | null = null
  let opened = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  let offerSdp = ''
  let answerSdp = ''
  let offerSent = false
  let remoteSet = false
  const pendingLocal: Array<{ candidate: string; mid: string }> = []
  const pendingRemote: Array<{ candidate: string; mid: string }> = []
  let iceSent = 0

  const clearTimers = (): void => {
    if (timer) clearTimeout(timer)
    if (graceTimer) clearTimeout(graceTimer)
    timer = null
    graceTimer = null
  }
  const teardown = (): void => {
    clearTimers()
    try {
      if (dc) {
        dc.onopen = dc.onmessage = dc.onclose = dc.onerror = dc.onbufferedamountlow = null
        dc.close()
      }
    } catch {
      /* ya cerrado */
    }
    try {
      if (pc) {
        pc.onicecandidate = pc.onconnectionstatechange = null
        pc.close()
      }
    } catch {
      /* ya cerrado */
    }
    closeWs()
    dc = null
    pc = null
  }
  const closeWs = (): void => {
    const s = ws
    ws = null
    if (!s) return
    s.onopen = s.onmessage = s.onclose = s.onerror = null
    try {
      s.close(1000)
    } catch {
      /* ya cerrado */
    }
  }
  const end = (why: LinkEnd): void => {
    if (ended) return
    ended = true
    teardown()
    h.onEnd(why)
  }
  const arm = (ms: number, why: LinkEnd): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => end(why), ms)
  }
  const sendSignal = (f: SignalClientFrame): void => {
    const s = encodeFrame(f)
    if (s && ws && ws.readyState === WebSocket.OPEN) ws.send(s)
  }
  const flushLocalIce = (): void => {
    while (pendingLocal.length > 0 && iceSent < MAX_ICE_SENT) {
      const c = pendingLocal.shift() as { candidate: string; mid: string }
      iceSent++
      sendSignal({ t: 'ice', candidate: c.candidate, mid: c.mid })
    }
  }
  const addRemote = (c: { candidate: string; mid: string }): void => {
    if (!pc) return
    pc.addIceCandidate({ candidate: c.candidate, sdpMid: c.mid || '0' }).catch(() => undefined)
  }

  const startRtc = async (): Promise<void> => {
    const conn = new RTCPeerConnection({ iceServers: [] })
    pc = conn
    conn.onicecandidate = (e) => {
      const c = e.candidate
      if (!c || !c.candidate || c.candidate.length > LIMITS.maxIceChars) return
      const mid = (c.sdpMid ?? '0').slice(0, LIMITS.maxMidChars)
      if (offerSent) {
        if (iceSent++ < MAX_ICE_SENT) sendSignal({ t: 'ice', candidate: c.candidate, mid })
      } else pendingLocal.push({ candidate: c.candidate, mid })
    }
    conn.onconnectionstatechange = () => {
      const st = conn.connectionState
      if (st === 'failed' || st === 'closed') end(opened ? { k: 'closed' } : { k: 'no-host' })
      else if (st === 'disconnected') {
        if (graceTimer) clearTimeout(graceTimer)
        graceTimer = setTimeout(() => end(opened ? { k: 'closed' } : { k: 'no-host' }), DISCONNECTED_GRACE_MS)
      } else if (st === 'connected' && graceTimer) {
        clearTimeout(graceTimer)
        graceTimer = null
      }
    }
    // El canal se crea DESPUÉS de `ready` (el servidor ya espera la oferta).
    const channel = conn.createDataChannel(DATACHANNEL_LABEL, { ordered: true })
    dc = channel
    channel.bufferedAmountLowThreshold = BUFFER.low
    channel.onbufferedamountlow = () => h.onDrain?.()
    channel.onopen = () => {
      if (ended || opened) return
      opened = true
      clearTimers()
      closeWs() // la señalización ya no hace falta
      h.onOpen({ offerSdp, answerSdp })
    }
    channel.onmessage = (e) => {
      if (typeof e.data === 'string') h.onMessage(e.data)
    }
    channel.onclose = () => end({ k: 'closed' })
    const offer = await conn.createOffer()
    if (ended) return
    await conn.setLocalDescription(offer)
    if (ended || !offer.sdp) return
    offerSdp = offer.sdp
    sendSignal({ t: 'offer', sdp: offer.sdp })
    offerSent = true
    flushLocalIce()
    arm(CHANNEL_TIMEOUT_MS, { k: 'no-host' })
  }

  if (!webrtcSupported()) {
    queueMicrotask(() => end({ k: 'unsupported' }))
    return { send: () => false, isOpen: () => false, bufferedAmount: () => 0, close: () => undefined }
  }

  try {
    ws = new WebSocket(wsUrl())
  } catch {
    queueMicrotask(() => end({ k: 'no-host' }))
    return { send: () => false, isOpen: () => false, bufferedAmount: () => 0, close: () => undefined }
  }
  arm(READY_TIMEOUT_MS, { k: 'no-host' })
  ws.onopen = () => sendSignal(hello)
  ws.onerror = () => undefined
  ws.onclose = () => {
    // Cerrar la señalización tras abrir el canal es normal; antes de eso, es un fallo.
    if (!opened && !ended) end({ k: 'no-host' })
  }
  let gotReady = false
  ws.onmessage = (e) => {
    const p = parseSignalHostFrame(e.data)
    if (!p.ok) return end({ k: 'signal-error', code: 'frame' })
    const f = p.value
    switch (f.t) {
      case 'ready':
        if (gotReady) return
        gotReady = true
        arm(CHANNEL_TIMEOUT_MS, { k: 'no-host' })
        startRtc().catch(() => end({ k: 'no-host' }))
        return
      case 'answer':
        if (!gotReady || !pc || remoteSet) return
        answerSdp = f.sdp
        remoteSet = true
        pc.setRemoteDescription({ type: 'answer', sdp: f.sdp })
          .then(() => {
            for (const c of pendingRemote.splice(0)) addRemote(c)
          })
          .catch(() => end({ k: 'no-host' }))
        return
      case 'ice':
        if (!gotReady) return
        if (remoteSet) addRemote({ candidate: f.candidate, mid: f.mid })
        else if (pendingRemote.length < 60) pendingRemote.push({ candidate: f.candidate, mid: f.mid })
        return
      case 'error':
        return end({ k: 'signal-error', code: f.code })
    }
  }

  return {
    send(text) {
      if (!dc || dc.readyState !== 'open') return false
      try {
        dc.send(text)
        return true
      } catch {
        return false
      }
    },
    isOpen: () => !!dc && dc.readyState === 'open',
    bufferedAmount: () => (dc ? dc.bufferedAmount : 0),
    close() {
      if (ended) return
      ended = true
      teardown()
    }
  }
}
