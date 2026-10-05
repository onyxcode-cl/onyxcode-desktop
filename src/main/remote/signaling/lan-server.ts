/**
 * Servidor HTTP + WebSocket mínimo del control remoto (solo mientras el modo está activo): ligado ÚNICAMENTE a la
 * IPv4 privada de la interfaz activa, en un puerto aleatorio. Sirve la PWA (estática) y hace de señalización
 * (SDP/ICE). Comprueba `Host` y `Origin`, admite como mucho 2 sockets y se apaga del todo al detenerse.
 * Por aquí NO viaja ningún dato de conversaciones ni credenciales del motor.
 *
 * MODO VIAJE (`tunnel`): el mismo servidor ligado SOLO a 127.0.0.1 (puerto aleatorio) y publicado por `cloudflared`. Cambia el
 * criterio de origen (`Host` y `Origin` = el host público del túnel, que se conoce cuando `cloudflared` lo imprime; mientras tanto
 * TODO responde 503) y añade la puerta previa: sin la galleta `__Host-onyxk` (que solo entrega `GET /k/<T>`) todo devuelve el mismo
 * 404. Rutas expuestas: `/k/<T>`, `/__onyx/probe/<nonce>` (autocomprobación del Mac, un solo uso), la PWA estática y `/ws`; `/cdn-cgi/`
 * (lo sirve Cloudflare en el mismo origen) no se usa. Límites de ritmo y keepalive del WebSocket (el borde corta a ~125 s sin tráfico).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import type { Duplex } from 'node:stream'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { t } from '@shared/i18n'
import { LIMITS, SIGNALING_PATH } from '@shared/remote/protocol'
import {
  TRAVEL_GATE_PREFIX,
  TRAVEL_KEEPALIVE,
  TRAVEL_LIMITS,
  TRAVEL_NONCE_RE,
  TRAVEL_PROBE_PREFIX,
  TRAVEL_RESERVED_PREFIX,
  TRAVEL_TOKEN_RE
} from '@shared/remote/travel'
import { SignalSession } from './session'
import { ProbeNonces, TunnelGate } from './tunnel-gate'
import { TunnelLimits, visitorHint } from './tunnel-limits'
import type { SignalingPeer, SignalingStartOptions, SignalingTransport } from './types'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8'
}
/**
 * Recurso con huella de Vite en el nombre (`assets/main-BaDQdc5Q.js`: 8 caracteres con algún dígito o mayúscula): cambia si
 * cambia el contenido, así que se cachea para siempre. Un nombre sin huella (`sin-huella.js`) nunca es inmutable.
 */
const HASHED_RE = /^\/(?:app\/)?assets\/[A-Za-z0-9_.-]+-(?=[A-Za-z0-9_-]*[0-9A-Z_])[A-Za-z0-9_-]{8}\.[a-z0-9]+(?:\.map)?$/
/** Solo se sirve `.gz` precomprimido de estos tipos (el resto, imágenes y fuentes, ya vienen comprimidos). */
const GZIP_TYPES = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.map', '.txt', '.webmanifest'])

/** Opciones del modo viaje: el servidor se liga a 127.0.0.1 y lo publica `cloudflared`. */
export interface TunnelServerOptions {
  gate: TunnelGate
  limits: TunnelLimits
  probes: ProbeNonces
  /** Origen público (`https://<palabras>.trycloudflare.com`), o `null` hasta que `cloudflared` imprime la URL (entonces todo es 503). */
  publicOrigin: () => string | null
  /** Pings del servidor y plazo máximo sin NADA del celular (por defecto 25 s y 90 s). */
  keepalive?: { pingMs: number; deadMs: number }
  /** Se llama cuando la puerta activa el bloqueo de `/k/*`, con el total acumulado de intentos erróneos (para auditar). */
  onGateReject?: (count: number) => void
  cookieMaxAgeSec?: number
}

export interface LanServerOptions {
  /** IPv4 privada a la que se liga (modo viaje: SIEMPRE `127.0.0.1`). */
  ip: string
  /** Modo viaje. Sin esto, comportamiento «Solo esta red» de siempre. */
  tunnel?: TunnelServerOptions
  /** Carpeta con la PWA compilada (`index.html`, …). Puede no existir (se muestra un aviso). */
  pwaDir: string
  /** Puerto preferido (D1: estable por instalación). Si está ocupado se usa uno libre sin tocar el guardado. */
  preferredPort?: number | null
  /** Se llama con el puerto en uso SOLO cuando no había uno preferido (para guardarlo). */
  onFirstPort?: (port: number) => void
}

export class LanSignalingServer implements SignalingTransport {
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private origin = ''
  private host = ''
  private listenPort = 0
  private peerCb: ((p: SignalingPeer) => void) | null = null
  private readonly sockets = new Set<WebSocket>()
  private readonly raw = new Set<Socket>()

  constructor(private readonly o: LanServerOptions) {}

  onPeer(cb: (peer: SignalingPeer) => void): void {
    this.peerCb = cb
  }

  /** Puerto local en uso (para lanzar `cloudflared --url http://127.0.0.1:<puerto>`). 0 = aún no escucha. */
  get port(): number {
    return this.listenPort
  }

  async start(opts: SignalingStartOptions): Promise<{ origin: string }> {
    if (this.server) throw new Error('already-started')
    const server = createServer((req, res) => this.handleHttp(req, res))
    server.requestTimeout = 10_000
    server.headersTimeout = 10_000
    server.keepAliveTimeout = 2_000
    server.maxHeadersCount = 40
    const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxSignalFrameBytes })
    this.server = server
    this.wss = wss
    server.on('connection', (s) => {
      this.raw.add(s)
      s.once('close', () => this.raw.delete(s))
    })
    server.on('upgrade', (req, socket, head) => {
      if (this.o.tunnel) return this.tunnelUpgrade(req, socket, head, wss, opts)
      if (!this.allowedUpgrade(req) || this.sockets.size >= LIMITS.maxSignalSockets) {
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
        socket.destroy()
        return
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.handleSocket(ws, opts))
    })
    const listen = (port: number): Promise<void> =>
      new Promise<void>((resolveListen, reject) => {
        server.once('error', reject)
        server.listen(port, this.o.ip, () => {
          server.off('error', reject)
          resolveListen()
        })
      })
    if (this.o.tunnel && this.o.ip !== '127.0.0.1') throw new Error('tunnel-must-bind-loopback')
    // Modo viaje: puerto aleatorio, nunca uno guardado.
    const preferred = this.o.tunnel ? null : (this.o.preferredPort ?? null)
    if (preferred) {
      try {
        await listen(preferred)
      } catch (err) {
        // Ocupado (o sin permiso): respaldo con un puerto libre; el puerto guardado se conserva para la próxima vez.
        if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE' && (err as NodeJS.ErrnoException).code !== 'EACCES') throw err
        await listen(0)
      }
    } else await listen(0)
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('no-address')
    if (!preferred && !this.o.tunnel) this.o.onFirstPort?.(addr.port)
    this.listenPort = addr.port
    this.host = `${this.o.ip}:${addr.port}`
    this.origin = `http://${this.host}`
    return { origin: this.origin }
  }

  async stop(): Promise<void> {
    const server = this.server
    const wss = this.wss
    this.server = null
    this.wss = null
    this.listenPort = 0
    for (const ws of this.sockets) {
      try {
        ws.terminate()
      } catch {
        /* ya cerrado */
      }
    }
    this.sockets.clear()
    wss?.close()
    if (server) {
      server.closeAllConnections()
      for (const s of this.raw) s.destroy()
      this.raw.clear()
      await new Promise<void>((r) => server.close(() => r()))
    }
  }

  // ── comprobaciones de origen ──

  private hostOk(req: IncomingMessage): boolean {
    return (req.headers.host ?? '').toLowerCase() === this.host
  }

  private allowedUpgrade(req: IncomingMessage): boolean {
    const path = (req.url ?? '').split('?')[0]
    if (path !== SIGNALING_PATH || !this.hostOk(req)) return false
    // Un navegador siempre manda Origin en un WebSocket: debe ser exactamente esta página.
    return req.headers.origin === this.origin
  }

  // ── HTTP estático ──

  private securityHeaders(cache = 'no-store'): Record<string, string> {
    const t = this.o.tunnel
    const pub = t?.publicOrigin() ?? null
    const connect = t ? `connect-src 'self'${pub ? ` wss://${new URL(pub).host}` : ''}` : `connect-src 'self' ws://${this.host}`
    return {
      ...(t ? { 'Cross-Origin-Opener-Policy': 'same-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' } : {}),
      'Cache-Control': cache,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self'",
        connect,
        "manifest-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'"
      ].join('; ')
    }
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const send = (status: number, body: string, type = 'text/plain; charset=utf-8'): void => {
      res.writeHead(status, { ...this.securityHeaders(), 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) })
      res.end(req.method === 'HEAD' ? undefined : body)
    }
    if (this.o.tunnel) return this.handleTunnelHttp(req, res, send)
    if (!this.hostOk(req)) return send(421, 'Misdirected request')
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed')
    this.serveStatic(req, res, send)
  }

  // ── modo viaje ──

  /** El 404 ÚNICO: lo que no existe, lo que no se lista y todo lo que no trae galleta responden exactamente esto. */
  private static readonly NOT_FOUND = 'Not found'

  private handleTunnelHttp(req: IncomingMessage, res: ServerResponse, send: (status: number, body: string, type?: string) => void): void {
    const t = this.o.tunnel as TunnelServerOptions
    const origin = t.publicOrigin()
    // Mientras `cloudflared` no haya dicho el nombre del túnel no hay ventana en la que se acepte otro `Host`.
    if (!origin) return send(503, 'Unavailable')
    if ((req.headers.host ?? '').toLowerCase() !== new URL(origin).host) return send(421, 'Misdirected request')
    const visitor = visitorHint(req.headers)
    if (!t.limits.http(visitor)) return send(429, 'Too many requests')
    const notFound = (): void => send(404, LanSignalingServer.NOT_FOUND)
    const path = (req.url ?? '/').split('?')[0].split('#')[0]
    const get = req.method === 'GET'
    // Autocomprobación del Mac: solo con un nonce recién generado y de un solo uso.
    if (path.startsWith(TRAVEL_PROBE_PREFIX)) {
      const n = path.slice(TRAVEL_PROBE_PREFIX.length)
      if (get && TRAVEL_NONCE_RE.test(n) && t.probes.consume(n)) return send(200, 'onyx-probe-ok')
      return notFound()
    }
    // Puerta: `GET /k/<T>` → galleta + 303 a `/` (el fragmento `#s=…` se conserva en la redirección).
    if (path.startsWith(TRAVEL_GATE_PREFIX)) {
      if (!get) return notFound()
      if (t.limits.gateLocked()) return send(429, 'Too many requests')
      const cand = path.slice(TRAVEL_GATE_PREFIX.length)
      if (TRAVEL_TOKEN_RE.test(cand) && t.gate.matches(cand)) {
        res.writeHead(303, {
          ...this.securityHeaders(),
          Location: '/',
          'Set-Cookie': t.gate.setCookie(t.cookieMaxAgeSec ?? TRAVEL_LIMITS.cookieMaxAgeSec),
          'Content-Length': 0
        })
        return void res.end()
      }
      if (t.limits.gateFail()) t.onGateReject?.(t.limits.failures)
      return notFound()
    }
    // Sin galleta válida: todo es un 404 idéntico (también `/`, `/ws` y `/cdn-cgi/`).
    if (!t.gate.check(req.headers.cookie)) return notFound()
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed')
    // `/cdn-cgi/` lo sirve Cloudflare en el mismo origen: aquí no hay nada (ni se usa).
    if (path.startsWith(TRAVEL_RESERVED_PREFIX)) return notFound()
    this.serveStatic(req, res, send, LanSignalingServer.NOT_FOUND)
  }

  private tunnelUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, wss: WebSocketServer, opts: SignalingStartOptions): void {
    const t = this.o.tunnel as TunnelServerOptions
    const reply = (status: number, text: string, body: string): void => {
      const h: Record<string, string | number> = {
        ...this.securityHeaders(),
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        Connection: 'close'
      }
      socket.write(
        `HTTP/1.1 ${status} ${text}\r\n${Object.entries(h)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')}\r\n\r\n${body}`
      )
      socket.destroy()
    }
    const origin = t.publicOrigin()
    if (!origin) return reply(503, 'Service Unavailable', 'Unavailable')
    if ((req.headers.host ?? '').toLowerCase() !== new URL(origin).host) return reply(421, 'Misdirected Request', 'Misdirected request')
    if (!t.limits.upgrade(visitorHint(req.headers))) return reply(429, 'Too Many Requests', 'Too many requests')
    const path = (req.url ?? '').split('?')[0]
    // Cada condición que falla responde el MISMO 404 que el HTTP (no se distingue «sin galleta» de «ruta equivocada»).
    if (path !== SIGNALING_PATH || !t.gate.check(req.headers.cookie) || req.headers.origin !== origin)
      return reply(404, 'Not Found', LanSignalingServer.NOT_FOUND)
    if (this.sockets.size >= LIMITS.maxSignalSockets) return reply(503, 'Service Unavailable', 'Busy')
    wss.handleUpgrade(req, socket, head, (ws) => this.handleSocket(ws, opts))
  }

  /**
   * Bytes de un archivo de la PWA tal como los serviría este servidor (`/` = `index.html`; sin PWA compilada, la página de aviso), o
   * `null`. Lo usa la autocomprobación del Mac para comparar lo que llega por el túnel con lo que sirve él.
   */
  readStatic(pathname: string): Buffer | null {
    const p = pathname === '/' || pathname === '' ? '/index.html' : pathname
    if (p.includes('\0') || p.includes('\\')) return null
    const root = resolve(this.o.pwaDir)
    const file = resolve(join(root, normalize(p)))
    if (file !== root && !file.startsWith(root + sep)) return null
    try {
      if (existsSync(file) && statSync(file).isFile()) return readFileSync(file)
    } catch {
      return null
    }
    return p === '/index.html' ? Buffer.from(fallbackPage()) : null
  }

  private serveStatic(
    req: IncomingMessage,
    res: ServerResponse,
    send: (status: number, body: string, type?: string) => void,
    notFoundBody = 'Not found'
  ): void {
    let pathname: string
    try {
      pathname = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0])
    } catch {
      return send(400, 'Bad request')
    }
    if (pathname.includes('\0') || pathname.includes('\\')) return send(400, 'Bad request')
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const root = resolve(this.o.pwaDir)
    const file = resolve(join(root, normalize(pathname)))
    if (file !== root && !file.startsWith(root + sep)) return send(404, notFoundBody)
    const type = MIME[extname(file).toLowerCase()]
    try {
      if (!type || !existsSync(file) || !statSync(file).isFile()) {
        if (pathname === '/index.html') return send(200, fallbackPage(), MIME['.html'])
        return send(404, notFoundBody)
      }
      // `.gz` precomprimido junto al original (lo deja `scripts/build-pwa.mjs`): un archivo grande no se comprime en cada petición.
      const ext = extname(file).toLowerCase()
      const accepts = /\bgzip\b/i.test(String(req.headers['accept-encoding'] ?? ''))
      const gz = accepts && GZIP_TYPES.has(ext) && existsSync(`${file}.gz`) && statSync(`${file}.gz`).isFile() ? `${file}.gz` : null
      const data = readFileSync(gz ?? file)
      // Con huella: inmutable. `index.html`, `entry.json` y lo demás: nunca de la caché (siempre apuntan a la versión vigente).
      const hashed = HASHED_RE.test(pathname)
      res.writeHead(200, {
        ...this.securityHeaders(hashed ? 'public, max-age=31536000, immutable' : 'no-store'),
        'Content-Type': type,
        'Content-Length': data.length,
        ...(gz ? { 'Content-Encoding': 'gzip' } : {}),
        ...(GZIP_TYPES.has(ext) ? { Vary: 'Accept-Encoding' } : {})
      })
      res.end(req.method === 'HEAD' ? undefined : data)
    } catch {
      send(500, 'Error')
    }
  }

  // ── señalización ──

  private handleSocket(ws: WebSocket, opts: SignalingStartOptions): void {
    this.sockets.add(ws)
    const session = new SignalSession({
      io: {
        send: (text) => {
          if (ws.readyState === ws.OPEN) ws.send(text)
        },
        close: (code) => {
          try {
            ws.close(code)
          } catch {
            /* ya cerrado */
          }
        }
      },
      authorize: (h) => opts.authorize(h),
      onPeer: (peer) => this.peerCb?.(peer)
    })
    let lastSeen = Date.now()
    ws.on('message', (data: RawData, isBinary: boolean) => {
      lastSeen = Date.now()
      session.receive(isBinary ? '' : data.toString('utf8'), isBinary)
    })
    // Keepalive (modo viaje): el borde de Cloudflare corta un WebSocket sin tráfico a ~125 s. El Mac manda un ping cada `pingMs` y
    // cierra el socket si en `deadMs` no llegó nada (pong o trama) del celular.
    let ka: ReturnType<typeof setInterval> | null = null
    if (this.o.tunnel) {
      const k = this.o.tunnel.keepalive ?? TRAVEL_KEEPALIVE
      ws.on('pong', () => (lastSeen = Date.now()))
      ka = setInterval(() => {
        if (Date.now() - lastSeen > k.deadMs) return ws.terminate()
        try {
          ws.ping()
        } catch {
          /* ya cerrado */
        }
      }, k.pingMs)
      ka.unref?.()
    }
    const onGone = (): void => {
      if (ka) clearInterval(ka)
      this.sockets.delete(ws)
      session.gone()
    }
    ws.on('close', onGone)
    ws.on('error', onGone)
  }
}

function fallbackPage(): string {
  const msg = t('remote.pwa.missing')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lazunox</title></head><body style="font-family:system-ui;padding:24px"><p>${msg.replace(/[<>&]/g, '')}</p></body></html>`
}
