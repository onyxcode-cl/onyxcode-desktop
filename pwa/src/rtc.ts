/**
 * Enlace con el Mac: señalización por WebSocket + RTCDataChannel `onyx`. El celular es quien ofrece (offer) y quien crea el
 * canal, DESPUÉS de recibir `ready`.
 *  - Red local (`/ws` en la IP del Mac): sin servidores STUN/TURN.
 *  - Servicio de conexión (`wss://<sitio>/v1/peer/<sala>`): STUN siempre, y los servidores de relé que reparta el servicio (trama
 *    `turn`, que llega ANTES de `ready` y solo después de que el Mac aceptó el `hello`).
 * Todo lo recibido por señalización se valida con los validadores compartidos.
 */
import { BUFFER } from '../../src/shared/remote/mux'
import { CLOUD_PEER_PREFIX, CLOUD_STUN_URL } from '../../src/shared/remote/cloud'
import { TRAVEL_STUN_URLS, TRAVEL_WS_RETRY } from '../../src/shared/remote/travel'
import {
  DATACHANNEL_LABEL,
  LIMITS,
  SIGNALING_PATH,
  encodeFrame,
  parseSignalHostFrame,
  type IceServerSpec,
  type SignalClientFrame,
  type SignalErrorCode
} from '../../src/shared/remote/protocol'

/** Plazo para que el servidor responda `ready` (WebSocket abierto + hello válido). */
export const READY_TIMEOUT_MS = 8_000
/** Plazo desde la respuesta hasta que el canal abre (aislamiento de clientes, firewall…). */
export const CHANNEL_TIMEOUT_MS = 15_000
/** Modo viaje: plazo de ICE (perforación UDP) desde la oferta; si no abre el canal, `ice-failed` («tu red bloquea la conexión directa»). */
export const TRAVEL_ICE_TIMEOUT_MS = 12_000
const DISCONNECTED_GRACE_MS = 6_000
const MAX_ICE_SENT = 50

export type LinkEnd =
  /** No se llegó al equipo (sin `ready` o sin canal a tiempo). */
  | { k: 'no-host' }
  | { k: 'signal-error'; code: SignalErrorCode }
  | { k: 'closed' }
  | { k: 'unsupported' }
  /** Solo modo viaje: la señalización fue bien pero la conexión directa no abrió a tiempo (NAT/UDP que no deja pasar). */
  | { k: 'ice-failed' }

export interface LinkHandlers {
  /**
   * El canal abrió; trae los SDP que aplicó la PROPIA pila (`localDescription` = offer, `remoteDescription` = answer): de sus
   * huellas sale el handshake. Vacío si la pila no los tiene (el llamador lo trata como fallo de protocolo).
   */
  onOpen(info: { offerSdp: string; answerSdp: string }): void
  onMessage(raw: string): void
  /** `bufferedAmount` bajó de `BUFFER.low` (control de flujo del multiplexor). */
  onDrain?(): void
  /** Se llama UNA vez cuando el enlace termina (antes o después de abrir). */
  onEnd(why: LinkEnd): void
}

/** Adónde se conecta el enlace: la red local (como siempre) o una sala del servicio de conexión. */
export type LinkTarget = { kind: 'lan' } | { kind: 'cloud'; room: string } | { kind: 'travel' }

export interface Link {
  /** `false` si el canal no está abierto o la trama no cabe. */
  send(text: string): boolean
  isOpen(): boolean
  /** Bytes pendientes en el búfer de salida del canal. */
  bufferedAmount(): number
  /** ¿La conexión viva pasa por un relé (TURN)? Mira el par de candidatos elegido; `false` si no se sabe. */
  viaRelay(): Promise<boolean>
  close(): void
}

export function webrtcSupported(): boolean {
  return typeof RTCPeerConnection === 'function' && typeof WebSocket === 'function'
}

function wsUrl(target: LinkTarget): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}${target.kind === 'cloud' ? `${CLOUD_PEER_PREFIX}${target.room}` : SIGNALING_PATH}`
}

/**
 * Servidores ICE de la nube: STUN siempre y, si el servicio los repartió, los de relé. Modo viaje: solo los STUN públicos sin cuenta
 * (sin relé). La red local no usa ninguno.
 */
export function iceServersFor(target: LinkTarget, turn: readonly IceServerSpec[]): RTCIceServer[] {
  if (target.kind === 'travel') return [{ urls: [...TRAVEL_STUN_URLS] }]
  return target.kind === 'cloud' ? [{ urls: [CLOUD_STUN_URL] }, ...turn.map((s) => ({ ...s, urls: [...s.urls] }))] : []
}

export function openLink(hello: Extract<SignalClientFrame, { t: 'hello' }>, h: LinkHandlers, target: LinkTarget = { kind: 'lan' }): Link {
  const travel = target.kind === 'travel'
  /** Fin si el canal no abre: en modo viaje es un fallo de la conexión directa (la señalización sí llegó). */
  const noChannel: LinkEnd = travel ? { k: 'ice-failed' } : { k: 'no-host' }
  let ended = false
  let ws: WebSocket | null = null
  let pc: RTCPeerConnection | null = null
  let dc: RTCDataChannel | null = null
  let opened = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let graceTimer: ReturnType<typeof setTimeout> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let offerSent = false
  let remoteSet = false
  const pendingLocal: Array<{ candidate: string; mid: string }> = []
  const pendingRemote: Array<{ candidate: string; mid: string }> = []
  let iceSent = 0
  let turnServers: IceServerSpec[] = []

  const clearTimers = (): void => {
    if (timer) clearTimeout(timer)
    if (graceTimer) clearTimeout(graceTimer)
    if (retryTimer) clearTimeout(retryTimer)
    timer = null
    graceTimer = null
    retryTimer = null
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
    const conn = new RTCPeerConnection({ iceServers: iceServersFor(target, turnServers), iceTransportPolicy: 'all' })
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
      if (st === 'failed' || st === 'closed') end(opened ? { k: 'closed' } : noChannel)
      else if (st === 'disconnected') {
        if (graceTimer) clearTimeout(graceTimer)
        graceTimer = setTimeout(() => end(opened ? { k: 'closed' } : noChannel), DISCONNECTED_GRACE_MS)
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
      // Las huellas salen de lo que la pila DTLS verificó contra los certificados, no de lo que creamos o recibimos por señalización.
      h.onOpen({ offerSdp: conn.localDescription?.sdp ?? '', answerSdp: conn.remoteDescription?.sdp ?? '' })
    }
    channel.onmessage = (e) => {
      if (typeof e.data === 'string') h.onMessage(e.data)
    }
    channel.onclose = () => end({ k: 'closed' })
    const offer = await conn.createOffer()
    if (ended) return
    await conn.setLocalDescription(offer)
    if (ended || !offer.sdp) return
    sendSignal({ t: 'offer', sdp: offer.sdp })
    offerSent = true
    flushLocalIce()
    arm(travel ? TRAVEL_ICE_TIMEOUT_MS : CHANNEL_TIMEOUT_MS, noChannel)
  }

  if (!webrtcSupported()) {
    queueMicrotask(() => end({ k: 'unsupported' }))
    return { send: () => false, isOpen: () => false, bufferedAmount: () => 0, viaRelay: async () => false, close: () => undefined }
  }

  let gotReady = false
  const onSignal = (e: MessageEvent): void => {
    const p = parseSignalHostFrame(e.data)
    if (!p.ok) return end({ k: 'signal-error', code: 'frame' })
    const f = p.value
    switch (f.t) {
      case 'ready':
        if (gotReady) return
        gotReady = true
        arm(travel ? TRAVEL_ICE_TIMEOUT_MS : CHANNEL_TIMEOUT_MS, noChannel)
        startRtc().catch(() => end({ k: 'no-host' }))
        return
      case 'turn':
        // Solo en la nube, una vez y antes de `ready` (con él se crea la conexión): después ya no sirve para nada.
        if (target.kind === 'cloud' && !gotReady && turnServers.length === 0) turnServers = f.servers
        return
      case 'answer':
        if (!gotReady || !pc || remoteSet) return
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

  let wsAttempt = 0
  let wsOpened = false
  const openWs = (): boolean => {
    try {
      ws = new WebSocket(wsUrl(target))
    } catch {
      return false
    }
    ws.onopen = () => {
      wsOpened = true
      sendSignal(hello)
    }
    ws.onerror = () => undefined
    ws.onclose = () => {
      // Modo viaje: el borde de Cloudflare a veces rechaza el upgrade (522) en los primeros segundos de un túnel. El navegador no
      // enseña el código: si el socket se cierra SIN haber abierto, se reintenta unas pocas veces con espera corta.
      if (travel && !wsOpened && !opened && !ended && wsAttempt < TRAVEL_WS_RETRY.maxAttempts) {
        const wait = TRAVEL_WS_RETRY.delaysMs[wsAttempt] ?? 1000
        wsAttempt++
        ws = null
        retryTimer = setTimeout(() => {
          retryTimer = null
          if (!ended && !openWs()) end({ k: 'no-host' })
        }, wait)
        return
      }
      // Cerrar la señalización tras abrir el canal es normal; antes de eso, es un fallo.
      if (!opened && !ended) end({ k: 'no-host' })
    }
    ws.onmessage = onSignal
    return true
  }

  const noLink: Link = {
    send: () => false,
    isOpen: () => false,
    bufferedAmount: () => 0,
    viaRelay: async () => false,
    close: () => undefined
  }
  if (!openWs()) {
    queueMicrotask(() => end({ k: 'no-host' }))
    return noLink
  }
  // Modo viaje: el plazo de `ready` incluye las esperas de los reintentos del WebSocket.
  arm(READY_TIMEOUT_MS + (travel ? TRAVEL_WS_RETRY.delaysMs.reduce((x, y) => x + y, 0) : 0), { k: 'no-host' })

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
    async viaRelay() {
      try {
        if (!pc) return false
        const stats = await pc.getStats()
        const byId = new Map<string, Record<string, unknown>>()
        stats.forEach((v: Record<string, unknown>) => byId.set(String(v.id), v))
        let pairId: string | null = null
        stats.forEach((v: Record<string, unknown>) => {
          if (v.type === 'transport' && typeof v.selectedCandidatePairId === 'string') pairId = v.selectedCandidatePairId
        })
        let pair: Record<string, unknown> | undefined = pairId ? byId.get(pairId) : undefined
        if (!pair)
          stats.forEach((v: Record<string, unknown>) => {
            if (v.type === 'candidate-pair' && (v.selected === true || (v.nominated === true && v.state === 'succeeded'))) pair = v
          })
        const local = pair ? byId.get(String(pair.localCandidateId)) : undefined
        const remote = pair ? byId.get(String(pair.remoteCandidateId)) : undefined
        return local?.candidateType === 'relay' || remote?.candidateType === 'relay'
      } catch {
        return false
      }
    },
    close() {
      if (ended) return
      ended = true
      teardown()
    }
  }
}
