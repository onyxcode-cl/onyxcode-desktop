/**
 * Comportamiento de UNA sala del servicio de conexión (la de un Mac). TypeScript puro, sin Node, sin DOM y sin APIs de Workers:
 * lo ejecutan igual el Durable Object real (`cloud/remoto-worker/src/room.ts`) y el doble local de pruebas sobre `ws`
 * (`src/main/remote/signaling/fake-cloud.ts`), así que lo que se prueba en el Mac es el mismo código que corre en la nube.
 *
 * QUÉ HACE: reenvía señalización entre el Mac (`host`, con su `hostToken`) y hasta 2 celulares (`peer`). No interpreta lo que
 * reenvía, no guarda nada (solo memoria y los «adjuntos» de cada socket, que sobreviven a la hibernación) y no registra datos.
 * QUÉ NO HACE: autenticar a nadie (eso lo hace el handshake por el canal directo, ligado a las huellas DTLS), ver credenciales,
 * ni tocar almacenamiento (no existe en su entorno).
 *
 * HIBERNACIÓN: el estado vive en memoria y en el adjunto de cada socket (`setAttachment`); tras despertar, `restore()` lo
 * reconstruye. Los contadores de abuso (celulares/min, `grant`/h) van en el adjunto del socket del host: sobreviven a la hibernación.
 */
import { CLOUD_LIMITS, CLOUD_PING, CLOUD_PONG, encodeCloudFrame, isRelayText, parseHostToCloud, roomOfTokenAsync } from './cloud'
import type { IceServerSpec, SignalErrorCode } from './protocol'

/** Lo mínimo que se usa de un WebSocket (el de Workers y el de `ws` lo cumplen). */
export interface CoreSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
}

/** Se guarda en el adjunto de cada socket (≤ 2 KiB en Workers). */
export type Attachment =
  | { role: 'host'; at: number; joins: number[]; grants: number[] }
  | { role: 'peer'; id: string; at: number; frames: number; waitUntil?: number }

export interface RoomEnv {
  now(): number
  /** Id de celular dentro de la sala (`/^[a-z0-9]{8,16}$/`). */
  newId(): string
  setAttachment(ws: CoreSocket, a: Attachment): void
  /** Última respuesta automática al `ping` del host (ms epoch) o `null` si aún no hubo. */
  hostAliveAt(ws: CoreSocket): number | null
  /** Pide credenciales TURN; `null` = no hay (se degrada a solo STUN). Ausente = TURN apagado. */
  fetchTurn?: () => Promise<IceServerSpec[] | null>
  /** Programa `fn` tras `ms`; devuelve cómo cancelarlo. */
  setTimer(ms: number, fn: () => void): () => void
  /** ¿El token presentado es el de esta sala? Por defecto `sha256(token) === room`. */
  verifyToken?: (token: string, room: string) => Promise<boolean>
}

interface PeerState {
  ws: CoreSocket
  id: string
  at: number
  frames: number
  /** Ya se reenvió el `hello` y falta la primera respuesta del Mac (`ready` o `error`). */
  waiting: boolean
  /** Cola de salida hacia ESTE celular y hacia el Mac: conserva el orden mientras se espera el TURN. */
  chain: Promise<void>
  cancelLife: (() => void) | null
  cancelReady: (() => void) | null
  closed: boolean
}

const MINUTE = 60_000
const HOUR = 3_600_000
const CLOSE_NORMAL = 1000
const CLOSE_POLICY = 1008

export class RoomCore {
  private host: CoreSocket | null = null
  private hostAt = 0
  private joins: number[] = []
  private grants: number[] = []
  private readonly peers = new Map<CoreSocket, PeerState>()

  constructor(private readonly env: RoomEnv) {}

  // ── hibernación ──

  /** Reconstruye el estado desde los adjuntos de los sockets vivos (tras despertar). */
  restore(entries: Array<{ ws: CoreSocket; att: Attachment | null }>): void {
    for (const { ws, att } of entries) {
      if (!att) {
        safeClose(ws, CLOSE_POLICY)
        continue
      }
      if (att.role === 'host') {
        this.host = ws
        this.hostAt = att.at
        this.joins = [...att.joins]
        this.grants = [...att.grants]
      }
    }
    for (const { ws, att } of entries) {
      if (att?.role !== 'peer') continue
      const p = this.makePeer(ws, att.id, att.at)
      p.frames = att.frames
      if (att.waitUntil !== undefined) this.armReady(p, Math.max(0, att.waitUntil - this.env.now()))
      this.peers.set(ws, p)
    }
  }

  // ── entrada de sockets ──

  /** El Mac se conecta presentando su token. `false` = rechazado (el socket queda cerrado). */
  async acceptHost(ws: CoreSocket, room: string, token: string): Promise<boolean> {
    const verify = this.env.verifyToken ?? (async (t: string, r: string) => (await roomOfTokenAsync(t)) === r)
    let ok = false
    try {
      ok = await verify(token, room)
    } catch {
      ok = false
    }
    if (!ok) {
      safeClose(ws, CLOSE_POLICY)
      return false
    }
    // Un host nuevo con el mismo token SUSTITUYE al anterior (el Mac reconecta tras cambiar de red).
    const old = this.host
    this.host = ws
    this.hostAt = this.env.now()
    if (old && old !== ws) {
      safeClose(old, CLOSE_NORMAL, 'replaced')
      // Los celulares que negociaban con la sesión anterior se pierden: se les avisa y reintentan.
      for (const p of [...this.peers.values()]) this.dropPeer(p, 'host-offline', false)
    }
    this.saveHost()
    return true
  }

  /** Un celular llega a la sala. */
  acceptPeer(ws: CoreSocket): void {
    const now = this.env.now()
    const host = this.host
    if (!host || now - Math.max(this.hostAt, this.env.hostAliveAt(host) ?? 0) > CLOUD_LIMITS.hostDeadMs) {
      return refuse(ws, 'host-offline')
    }
    this.joins = this.joins.filter((t) => now - t < MINUTE)
    if (this.joins.length >= CLOUD_LIMITS.peersPerMinute) return refuse(ws, 'rate')
    if (this.peers.size >= CLOUD_LIMITS.maxPeersPerRoom) return refuse(ws, 'busy')
    this.joins.push(now)
    const p = this.makePeer(ws, this.env.newId(), now)
    this.peers.set(ws, p)
    this.env.setAttachment(ws, { role: 'peer', id: p.id, at: now, frames: 0 })
    this.saveHost()
    this.toHost({ t: 'peer', id: p.id })
  }

  onMessage(ws: CoreSocket, data: string | ArrayBuffer): void {
    if (ws === this.host) return void this.onHostMessage(ws, data)
    const p = this.peers.get(ws)
    if (!p || p.closed) return safeClose(ws, CLOSE_POLICY)
    if (typeof data !== 'string' || !isRelayText(data)) return this.dropPeer(p, 'frame', true)
    if (++p.frames > CLOUD_LIMITS.maxPeerFrames) return this.dropPeer(p, 'frame', true)
    // La primera trama del celular es su `hello`: el Mac tiene 5 s para contestar `ready` o `error`.
    if (p.frames === 1) this.armReady(p, CLOUD_LIMITS.readyMs)
    this.env.setAttachment(p.ws, { role: 'peer', id: p.id, at: p.at, frames: p.frames, ...this.waitField(p) })
    this.toHost({ t: 'from', id: p.id, d: data })
  }

  onClose(ws: CoreSocket): void {
    if (ws === this.host) {
      this.host = null
      for (const p of [...this.peers.values()]) this.dropPeer(p, 'host-offline', false)
      return
    }
    const p = this.peers.get(ws)
    if (p) this.dropPeer(p, null, true)
  }

  // ── host ──

  private onHostMessage(ws: CoreSocket, data: string | ArrayBuffer): void {
    if (typeof data !== 'string') return safeClose(ws, CLOSE_POLICY)
    if (data === CLOUD_PING) return safeSend(ws, CLOUD_PONG)
    const f = parseHostToCloud(data)
    if (!f.ok) return safeClose(ws, CLOSE_POLICY)
    const p = this.byId(f.value.id)
    if (!p) return // el celular ya se fue
    switch (f.value.t) {
      case 'kick':
        // Va por la misma cola que los `to`: lo último que el Mac le mandó (p. ej. `error`) sale ANTES de cerrar.
        return this.enqueue(p, () => this.dropPeer(p, null, false)) // lo pidió el Mac: no hace falta avisarle
      case 'to': {
        const d = f.value.d
        // La primera respuesta del Mac (`ready` o `error`) cierra la espera de 5 s; no se interpreta el contenido.
        if (p.waiting) {
          p.waiting = false
          p.cancelReady?.()
          p.cancelReady = null
          this.env.setAttachment(p.ws, { role: 'peer', id: p.id, at: p.at, frames: p.frames })
        }
        this.enqueue(p, () => safeSend(p.ws, d))
        return
      }
      case 'grant':
        return this.onGrant(p)
    }
  }

  /** El Mac aceptó el `hello`: se piden credenciales TURN y se mandan al Mac y al celular ANTES de la siguiente trama `to`. */
  private onGrant(p: PeerState): void {
    const fetchTurn = this.env.fetchTurn
    const now = this.env.now()
    this.grants = this.grants.filter((t) => now - t < HOUR)
    if (!fetchTurn || this.grants.length >= CLOUD_LIMITS.grantsPerHour) return
    this.grants.push(now)
    this.saveHost()
    this.enqueue(p, async () => {
      let servers: IceServerSpec[] | null = null
      try {
        servers = await fetchTurn()
      } catch {
        servers = null // degrada a solo STUN
      }
      if (!servers || servers.length === 0 || p.closed) return
      this.toHost({ t: 'turn', id: p.id, servers })
      safeSend(p.ws, JSON.stringify({ t: 'turn', servers }))
    })
  }

  // ── piezas ──

  private makePeer(ws: CoreSocket, id: string, at: number): PeerState {
    const p: PeerState = {
      ws,
      id,
      at,
      frames: 0,
      waiting: false,
      chain: Promise.resolve(),
      cancelLife: null,
      cancelReady: null,
      closed: false
    }
    p.cancelLife = this.env.setTimer(Math.max(0, at + CLOUD_LIMITS.peerLifetimeMs - this.env.now()), () => this.dropPeer(p, null, true))
    return p
  }

  private armReady(p: PeerState, ms: number): void {
    p.waiting = true
    p.cancelReady?.()
    p.cancelReady = this.env.setTimer(ms, () => {
      if (p.waiting && !p.closed) this.dropPeer(p, 'host-offline', true)
    })
  }

  private waitField(p: PeerState): { waitUntil?: number } {
    return p.waiting ? { waitUntil: this.env.now() + CLOUD_LIMITS.readyMs } : {}
  }

  private enqueue(p: PeerState, job: () => void | Promise<void>): void {
    p.chain = p.chain.then(job).catch(() => undefined)
  }

  private byId(id: string): PeerState | null {
    for (const p of this.peers.values()) if (p.id === id) return p
    return null
  }

  private toHost(f: Parameters<typeof encodeCloudFrame>[0]): void {
    if (this.host) safeSend(this.host, encodeCloudFrame(f))
  }

  /** Cierra un celular. `code` (si hay) se le dice antes de cerrar; `tellHost` avisa al Mac con `gone`. */
  private dropPeer(p: PeerState, code: SignalErrorCode | null, tellHost: boolean): void {
    if (p.closed) return
    p.closed = true
    p.cancelLife?.()
    p.cancelReady?.()
    this.peers.delete(p.ws)
    if (code) safeSend(p.ws, JSON.stringify({ t: 'error', code }))
    safeClose(p.ws, CLOSE_NORMAL)
    if (tellHost) this.toHost({ t: 'gone', id: p.id })
  }

  private saveHost(): void {
    if (this.host) this.env.setAttachment(this.host, { role: 'host', at: this.hostAt, joins: this.joins, grants: this.grants })
  }
}

function refuse(ws: CoreSocket, code: SignalErrorCode): void {
  safeSend(ws, JSON.stringify({ t: 'error', code }))
  safeClose(ws, CLOSE_NORMAL)
}

function safeSend(ws: CoreSocket, s: string): void {
  try {
    ws.send(s)
  } catch {
    /* socket ya cerrado */
  }
}

function safeClose(ws: CoreSocket, code: number, reason?: string): void {
  try {
    ws.close(code, reason)
  } catch {
    /* socket ya cerrado */
  }
}
