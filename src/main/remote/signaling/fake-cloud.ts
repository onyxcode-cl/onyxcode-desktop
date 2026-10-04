/**
 * SOLO PARA PRUEBAS: el servicio de conexión en local. Un servidor `ws` en 127.0.0.1 (puerto libre, sin red externa) que ejecuta
 * el MISMO `routeEdge` y el MISMO `RoomCore` que el Worker real (`cloud/remoto-worker`), de modo que lo que se prueba aquí con el
 * transporte del Mac es el comportamiento de la nube salvo la envoltura de Cloudflare. No se importa desde código de producción.
 */
import { createServer, type Server } from 'node:http'
import type { Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { CLOUD_ENVELOPE_MAX_BYTES, CLOUD_HOST_HEADER, CLOUD_PING, CLOUD_PONG, CLOUD_ORIGIN } from '@shared/remote/cloud'
import { routeEdge } from '@shared/remote/cloud-edge'
import type { IceServerSpec } from '@shared/remote/protocol'
import { RoomCore, type CoreSocket } from '@shared/remote/room-core'

export interface FakeCloudOptions {
  /** Credenciales TURN que reparte tras un `grant` (`null`/ausente = TURN apagado). */
  turn?: IceServerSpec[] | null
  allowedOrigins?: string[]
}

export class FakeCloud {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private readonly rooms = new Map<string, RoomCore>()
  private readonly alive = new WeakMap<object, number>()
  private readonly raw = new Set<Socket>()
  /** Cuántas veces el Mac abrió un socket de host (para comprobar reconexiones). */
  hostConnections = 0
  /** Sockets de host abiertos ahora. */
  openHosts = 0
  turn: IceServerSpec[] | null

  constructor(private readonly o: FakeCloudOptions = {}) {
    this.turn = o.turn ?? null
  }

  async start(): Promise<string> {
    const server = createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    const wss = new WebSocketServer({ noServer: true, maxPayload: CLOUD_ENVELOPE_MAX_BYTES })
    this.server = server
    this.wss = wss
    server.on('connection', (s) => {
      this.raw.add(s)
      s.once('close', () => this.raw.delete(s))
    })
    server.on('upgrade', (req, socket, head) => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        const hostHeader = req.headers[CLOUD_HOST_HEADER]
        const d = await routeEdge(
          {
            method: req.method ?? 'GET',
            pathname: url.pathname,
            upgrade: String(req.headers.upgrade ?? ''),
            origin: typeof req.headers.origin === 'string' ? req.headers.origin : null,
            hostToken: typeof hostHeader === 'string' ? hostHeader : null
          },
          { allowedOrigins: this.o.allowedOrigins ?? [CLOUD_ORIGIN] }
        )
        if (d.kind !== 'host' && d.kind !== 'peer') {
          socket.write(`HTTP/1.1 ${d.kind === 'reject' ? d.status : 404} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
          socket.destroy()
          return
        }
        const core = this.core(d.room)
        wss.handleUpgrade(req, socket, head, (ws) => {
          const cs = ws as unknown as CoreSocket
          ws.on('message', (data, isBinary) => {
            const text = isBinary ? null : data.toString('utf8')
            if (d.kind === 'host' && text === CLOUD_PING) {
              // Igual que la respuesta automática del Durable Object: no pasa por el núcleo.
              this.alive.set(ws, Date.now())
              ws.send(CLOUD_PONG)
              return
            }
            core.onMessage(cs, text ?? new ArrayBuffer(0))
          })
          const gone = (): void => {
            if (d.kind === 'host') this.openHosts--
            core.onClose(cs)
          }
          ws.on('close', gone)
          ws.on('error', () => undefined)
          if (d.kind === 'host') {
            this.hostConnections++
            this.openHosts++
            void core.acceptHost(cs, d.room, d.token)
          } else core.acceptPeer(cs)
        })
      })()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no-address')
    return `ws://127.0.0.1:${addr.port}`
  }

  private core(room: string): RoomCore {
    let c = this.rooms.get(room)
    if (!c) {
      c = new RoomCore({
        now: () => Date.now(),
        newId: () => randomBytes(6).toString('hex'),
        setAttachment: () => undefined,
        hostAliveAt: (ws) => this.alive.get(ws as object) ?? null,
        fetchTurn: async () => this.turn,
        setTimer: (ms, fn) => {
          const t = setTimeout(fn, ms)
          t.unref()
          return () => clearTimeout(t)
        }
      })
      this.rooms.set(room, c)
    }
    return c
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    for (const ws of this.wss?.clients ?? []) (ws as WebSocket).terminate()
    this.wss?.close()
    this.wss = null
    if (server) {
      server.closeAllConnections()
      for (const s of this.raw) s.destroy()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }
}
