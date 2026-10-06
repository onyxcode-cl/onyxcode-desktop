/**
 * Durable Object de UNA sala (un Mac). Es una envoltura fina de `RoomCore` (`src/shared/remote/room-core.ts`), que es donde vive
 * todo el comportamiento y donde están las pruebas. Usa WebSocket Hibernation: sin tramas el objeto duerme y no cuesta nada.
 *
 * NO guarda nada: no hay `storage`, ni alarmas, ni registros. El estado vive en memoria y en los adjuntos de los sockets.
 */
import { CLOUD_HOST_HEADER, CLOUD_PING, CLOUD_PONG } from '../../../src/shared/remote/cloud'
import { fetchTurnServers, type TurnEnv } from '../../../src/shared/remote/cloud-turn'
import { RoomCore, type Attachment } from '../../../src/shared/remote/room-core'

export interface RoomEnv extends TurnEnv {
  ALLOWED_ORIGINS?: string
}

/** Cabeceras internas que pone el Worker de entrada (las del cliente se descartan allí). */
export const ROLE_HEADER = 'x-lazunox-role'
export const ROOM_HEADER = 'x-lazunox-room'

const newId = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(8))
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
}

export class Room {
  private readonly core: RoomCore

  constructor(
    private readonly ctx: DurableObjectState,
    env: RoomEnv
  ) {
    // La respuesta automática no despierta al objeto; su marca de tiempo dice si el Mac sigue vivo.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(CLOUD_PING, CLOUD_PONG))
    this.core = new RoomCore({
      now: () => Date.now(),
      newId,
      setAttachment: (ws, a) => (ws as DurableSocket).serializeAttachment(a),
      hostAliveAt: (ws) => ctx.getWebSocketAutoResponseTimestamp(ws as WebSocket)?.getTime() ?? null,
      ...(env.TURN_ENABLED === 'true' ? { fetchTurn: () => fetchTurnServers(env, (url, init) => fetch(url, init)) } : {}),
      setTimer: (ms, fn) => {
        const t = setTimeout(fn, ms)
        return () => clearTimeout(t)
      }
    })
    this.core.restore(ctx.getWebSockets().map((ws) => ({ ws, att: (ws.deserializeAttachment() as Attachment | null) ?? null })))
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response(null, { status: 426 })
    const pair = new WebSocketPair()
    const client = pair[0]
    const server = pair[1]
    this.ctx.acceptWebSocket(server)
    if (request.headers.get(ROLE_HEADER) === 'host') {
      await this.core.acceptHost(server, request.headers.get(ROOM_HEADER) ?? '', request.headers.get(CLOUD_HOST_HEADER) ?? '')
    } else {
      this.core.acceptPeer(server)
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    this.core.onMessage(ws, message)
  }

  webSocketClose(ws: WebSocket): void {
    this.core.onClose(ws)
  }

  webSocketError(ws: WebSocket): void {
    this.core.onClose(ws)
  }
}
