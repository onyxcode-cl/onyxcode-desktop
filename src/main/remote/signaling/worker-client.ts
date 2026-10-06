/**
 * Transporte de señalización por el servicio de conexión («También fuera de casa»). El Mac SALE hacia fuera con un WebSocket
 * (`wss://<CLOUD_DOMAIN>/v1/host`; EXTERNO-PENDIENTE: D3): no abre ningún puerto ni sirve la PWA (la sirve el sitio). El servicio solo reenvía las
 * tramas de señalización de cada celular; todo lo demás (handshake, PIN, datos) va por el canal WebRTC directo.
 *
 *  - Presenta su `hostToken` en una cabecera (no en la URL). Con la sala de vinculación abierta hay un SEGUNDO socket con el token
 *    efímero del QR vigente; así el celular que escribe el código llega por una sala distinta a la del uso normal.
 *  - Cada celular (`peer`) es una `SignalSession` (la misma de la red local). El servicio manda `grant` ANTES de `ready`: es la
 *    única vía por la que se piden credenciales de relé, y solo después de que `authorize` aceptó el `hello`.
 *  - Sin `allowed()` (política) NO se crea ningún socket. Valida cada trama del servicio; una inválida cierra el socket.
 *  - Reconexión con espera exponencial con azar (1 s … 60 s); `suspend()` cierra al instante (el servicio se entera enseguida de que
 *    el Mac duerme) y `resume()`/`networkChanged()` reconectan ya. Ping de aplicación cada 60 s.
 */
import { WebSocket } from 'ws'
import {
  CLOUD_HOST_HEADER,
  CLOUD_HOST_PATH,
  CLOUD_ORIGIN,
  CLOUD_PING,
  CLOUD_PONG,
  CLOUD_LIMITS,
  CLOUD_ENVELOPE_MAX_BYTES,
  encodeCloudFrame,
  parseCloudToHost,
  roomOfToken,
  type HostToCloudFrame
} from '@shared/remote/cloud'
import { LIMITS } from '@shared/remote/protocol'
import type { IceServerSpec } from '@shared/remote/protocol'
import { SignalSession } from './session'
import type { SignalingPeer, SignalingStartOptions, SignalingTransport, TransportStatus } from './types'

/** Lo mínimo de un WebSocket cliente (inyectable en las pruebas). */
export interface CloudSocket {
  send(text: string): void
  close(code?: number): void
  onOpen(cb: () => void): void
  onMessage(cb: (text: string, binary: boolean) => void): void
  onClose(cb: () => void): void
}
export type CloudSocketFactory = (url: string, headers: Record<string, string>) => CloudSocket

export interface CloudTimers {
  set(fn: () => void, ms: number): unknown
  clear(h: unknown): void
}

export interface CloudTransportOptions {
  /** `wss://<CLOUD_DOMAIN>` por defecto (EXTERNO-PENDIENTE: D3). Solo se admite `wss://` (o `ws://127.0.0.1` en las pruebas). */
  baseUrl?: string
  /** `hostToken` de este Mac (`null` = no hay: no se conecta). */
  hostToken: () => string | null
  /** Política y vigilancia del sitio: `false` = no se crea ningún socket y los abiertos se cierran. */
  allowed: () => boolean
  createSocket?: CloudSocketFactory
  timers?: CloudTimers
  /** Azar para el reintento (0..1). */
  rand?: () => number
  pingMs?: number
  pongWithinMs?: number
}

const REAL_TIMERS: CloudTimers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
const PONG_WITHIN_MS = 20_000
const BACKOFF_BASE_MS = 1_000
const BACKOFF_MAX_MS = 60_000

function wsSocket(url: string, headers: Record<string, string>): CloudSocket {
  const ws = new WebSocket(url, { headers, maxPayload: CLOUD_ENVELOPE_MAX_BYTES, handshakeTimeout: 10_000, perMessageDeflate: false })
  return {
    send: (t) => ws.send(t),
    close: (code) => {
      try {
        if (ws.readyState === ws.CONNECTING) ws.terminate()
        else ws.close(code ?? 1000)
      } catch {
        /* ya cerrado */
      }
    },
    onOpen: (cb) => void ws.on('open', cb),
    onMessage: (cb) => void ws.on('message', (d, bin) => cb(bin ? '' : d.toString('utf8'), bin)),
    onClose: (cb) => {
      ws.on('close', cb)
      ws.on('error', () => undefined) // el cierre llega por `close`
    }
  }
}

export function validBaseUrl(u: string): boolean {
  return /^wss:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(u) || /^ws:\/\/127\.0\.0\.1:\d{1,5}$/.test(u)
}

/** Una conexión de «host» con el servicio (la principal o la de vinculación) y los celulares que llegan por ella. */
class HostLink {
  private socket: CloudSocket | null = null
  private open = false
  private attempt = 0
  private retry: unknown = null
  private pingT: unknown = null
  private pongT: unknown = null
  private closedForGood = false
  private readonly sessions = new Map<string, SignalSession>()
  private readonly turn = new Map<string, IceServerSpec[]>()
  readonly room: string

  constructor(
    private readonly t: CloudSignalingTransport,
    private readonly token: string,
    readonly kind: 'main' | 'pair'
  ) {
    this.room = roomOfToken(token)
  }

  get isOpen(): boolean {
    return this.open
  }

  connect(): void {
    if (this.closedForGood || this.socket || !this.t.canConnect()) return
    this.t.statusOf(this, 'connecting')
    let sock: CloudSocket
    try {
      sock = this.t.opts.createSocket!(`${this.t.baseUrl}${CLOUD_HOST_PATH}`, { [CLOUD_HOST_HEADER]: this.token })
    } catch {
      this.socket = null
      return this.scheduleRetry()
    }
    this.socket = sock
    sock.onOpen(() => {
      if (this.socket !== sock) return
      this.open = true
      this.attempt = 0
      this.t.statusOf(this, 'online')
      this.startPing()
    })
    sock.onMessage((text, binary) => {
      if (this.socket !== sock) return
      if (binary) return sock.close(1008)
      this.onText(sock, text)
    })
    sock.onClose(() => {
      if (this.socket !== sock) return
      this.dropSocket()
      this.t.statusOf(this, 'offline')
      this.scheduleRetry()
    })
  }

  /** Cierra el socket actual (si lo hay) y suelta a los celulares en curso. No programa reintento por sí mismo. */
  private dropSocket(): void {
    const s = this.socket
    this.socket = null
    this.open = false
    this.stopPing()
    for (const sess of this.sessions.values()) sess.gone()
    this.sessions.clear()
    this.turn.clear()
    try {
      s?.close(1000)
    } catch {
      /* ya cerrado */
    }
  }

  /** Cierre definitivo (parada, política, QR vencido): sin reintentos. */
  shutdown(): void {
    this.closedForGood = true
    if (this.retry) this.t.timers.clear(this.retry)
    this.retry = null
    this.dropSocket()
    this.t.statusOf(this, 'offline')
  }

  /** Cierra y reconecta YA (cambio de red, despertar). */
  reconnectNow(): void {
    if (this.closedForGood) return
    if (this.retry) this.t.timers.clear(this.retry)
    this.retry = null
    this.dropSocket()
    this.attempt = 0
    this.connect()
  }

  /** Cierra sin reintentar (el Mac se duerme); `reconnectNow()` lo reabre. */
  pause(): void {
    if (this.retry) this.t.timers.clear(this.retry)
    this.retry = null
    this.dropSocket()
    this.t.statusOf(this, 'offline')
  }

  private scheduleRetry(): void {
    if (this.closedForGood || this.retry || !this.t.canConnect()) return
    const exp = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.min(this.attempt, 10))
    this.attempt++
    const wait = Math.round(exp * (0.5 + 0.5 * (this.t.rand() || 0)))
    this.retry = this.t.timers.set(() => {
      this.retry = null
      this.connect()
    }, wait)
  }

  private startPing(): void {
    this.stopPing()
    this.armPing()
  }

  private armPing(): void {
    this.pingT = this.t.timers.set(() => {
      const s = this.socket
      if (!s || !this.open) return
      try {
        s.send(CLOUD_PING)
      } catch {
        return s.close(1000)
      }
      // Sin `pong` a tiempo el enlace se da por muerto (cierra y reconecta).
      this.pongT = this.t.timers.set(() => s.close(1000), this.t.opts.pongWithinMs ?? PONG_WITHIN_MS)
      this.armPing()
    }, this.t.opts.pingMs ?? CLOUD_LIMITS.pingMs)
  }

  private stopPing(): void {
    if (this.pingT) this.t.timers.clear(this.pingT)
    if (this.pongT) this.t.timers.clear(this.pongT)
    this.pingT = null
    this.pongT = null
  }

  private send(f: HostToCloudFrame): void {
    if (!this.open || !this.socket) return
    try {
      this.socket.send(encodeCloudFrame(f))
    } catch {
      /* el cierre llega por onClose */
    }
  }

  private onText(sock: CloudSocket, text: string): void {
    if (text === CLOUD_PONG) {
      if (this.pongT) this.t.timers.clear(this.pongT)
      this.pongT = null
      return
    }
    const p = parseCloudToHost(text)
    if (!p.ok) return sock.close(1008) // el servicio no manda nada inválido: se corta y se reintenta
    const f = p.value
    switch (f.t) {
      case 'peer': {
        if (this.sessions.has(f.id)) return
        if (this.sessions.size >= LIMITS.maxSignalSockets) return this.send({ t: 'kick', id: f.id })
        const id = f.id
        let kicked = false
        const sess = new SignalSession({
          io: {
            send: (d) => this.send({ t: 'to', id, d }),
            close: () => {
              if (kicked) return
              kicked = true
              this.send({ t: 'kick', id })
            }
          },
          room: this.room,
          authorize: (h, room) => this.t.startOpts?.authorize(h, room) ?? false,
          // `grant` solo tras aceptar el `hello` y antes de `ready`; con `allowRelay: false` el Mac no concede relé.
          beforeReady: () => {
            if (this.t.startOpts?.allowRelay?.() ?? true) this.send({ t: 'grant', id })
          },
          iceServers: () => this.turn.get(id) ?? [],
          onPeer: (peer) => this.t.emitPeer(peer),
          setTimer: (fn, ms) => this.t.timers.set(fn, ms) as ReturnType<typeof setTimeout>,
          clearTimer: (h) => this.t.timers.clear(h)
        })
        this.sessions.set(id, sess)
        return
      }
      case 'from':
        return this.sessions.get(f.id)?.receive(f.d)
      case 'gone': {
        const s = this.sessions.get(f.id)
        this.sessions.delete(f.id)
        this.turn.delete(f.id)
        return s?.gone()
      }
      case 'turn':
        if (this.sessions.has(f.id)) this.turn.set(f.id, f.servers)
        return
    }
  }
}

export class CloudSignalingTransport implements SignalingTransport {
  readonly baseUrl: string
  readonly timers: CloudTimers
  readonly opts: CloudTransportOptions & { createSocket: CloudSocketFactory }
  startOpts: SignalingStartOptions | null = null
  private peerCb: ((p: SignalingPeer) => void) | null = null
  private main: HostLink | null = null
  private pair: HostLink | null = null
  private pairToken: string | null = null
  private stopped = true
  private suspended = false
  private current: TransportStatus = 'offline'
  private readonly statusCbs: Array<(s: TransportStatus) => void> = []

  constructor(o: CloudTransportOptions) {
    const base = o.baseUrl ?? CLOUD_ORIGIN.replace(/^https:/, 'wss:')
    if (!validBaseUrl(base)) throw new Error('bad-cloud-url')
    this.baseUrl = base
    this.timers = o.timers ?? REAL_TIMERS
    this.opts = { ...o, createSocket: o.createSocket ?? wsSocket }
  }

  rand(): number {
    return (this.opts.rand ?? Math.random)()
  }

  /** ¿Se puede abrir un socket ahora? Política, vigilancia, parada y reposo mandan; sin ellas NO se crea nada. */
  canConnect(): boolean {
    return !this.stopped && !this.suspended && this.opts.allowed()
  }

  onPeer(cb: (peer: SignalingPeer) => void): void {
    this.peerCb = cb
  }

  emitPeer(p: SignalingPeer): void {
    this.peerCb?.(p)
  }

  async start(opts: SignalingStartOptions): Promise<{ origin: string }> {
    this.startOpts = opts
    this.stopped = false
    const token = this.opts.hostToken()
    if (!token) throw new Error('no-host-token')
    this.main = new HostLink(this, token, 'main')
    this.setStatus(this.canConnect() ? 'connecting' : 'offline')
    this.main.connect()
    if (this.pairToken) this.openPair(this.pairToken)
    return { origin: CLOUD_ORIGIN }
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.main?.shutdown()
    this.pair?.shutdown()
    this.main = null
    this.pair = null
    this.setStatus('offline')
  }

  setPairRoom(hostToken: string | null): void {
    this.pairToken = hostToken
    this.pair?.shutdown()
    this.pair = null
    if (hostToken && !this.stopped) this.openPair(hostToken)
  }

  private openPair(token: string): void {
    this.pair = new HostLink(this, token, 'pair')
    this.pair.connect()
  }

  status(): TransportStatus {
    return this.current
  }

  onStatus(cb: (s: TransportStatus) => void): void {
    this.statusCbs.push(cb)
  }

  /** Solo el enlace principal da el estado que ve el dueño en Ajustes. */
  statusOf(link: HostLink, s: TransportStatus): void {
    if (link === this.main) this.setStatus(s)
  }

  private setStatus(s: TransportStatus): void {
    if (s === this.current) return
    this.current = s
    for (const cb of this.statusCbs) cb(s)
  }

  // ── reposo y red ──

  /** El Mac se va a dormir: se cierra YA para que el servicio lo sepa y no ofrezca un Mac que no contesta. */
  suspend(): void {
    this.suspended = true
    this.main?.pause()
    this.pair?.pause()
  }

  /** El Mac despertó o volvió la red: reconectar ya. */
  resume(): void {
    this.suspended = false
    if (this.stopped) return
    this.main?.reconnectNow()
    this.pair?.reconnectNow()
  }

  /** Cambió la red (Wi-Fi ↔ cable): los sockets viejos están muertos aunque no lo sepan. */
  networkChanged(): void {
    if (!this.stopped && !this.suspended) this.resume()
  }

  /** La política o la vigilancia cambiaron: cierra lo abierto si ya no se permite, o reabre si se vuelve a permitir. */
  recheck(): void {
    if (this.stopped) return
    if (!this.opts.allowed()) {
      this.main?.pause()
      this.pair?.pause()
    } else if (!this.suspended) {
      if (this.main && !this.main.isOpen) this.main.reconnectNow()
      if (this.pair && !this.pair.isOpen) this.pair.reconnectNow()
    }
  }
}
