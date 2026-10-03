/**
 * Servidor HTTP + WebSocket mínimo del control remoto (solo mientras el modo está activo): ligado ÚNICAMENTE a la
 * IPv4 privada de la interfaz activa, en un puerto aleatorio. Sirve la PWA (estática) y hace de señalización
 * (SDP/ICE). Comprueba `Host` y `Origin`, admite como mucho 2 sockets y se apaga del todo al detenerse.
 * Por aquí NO viaja ningún dato de conversaciones ni credenciales del motor.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Socket } from 'node:net'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { WebSocketServer, type RawData, type WebSocket } from 'ws'
import { t } from '@shared/i18n'
import { LIMITS, PROTOCOL_VERSION, SIGNALING_PATH, encodeFrame, parseSignalClientFrame } from '@shared/remote/protocol'
import type { SignalErrorCode, SignalHostFrame } from '@shared/remote/protocol'
import type { SignalHello, SignalingPeer, SignalingStartOptions, SignalingTransport } from './types'

const HELLO_TIMEOUT_MS = 5_000
const MAX_ICE_FRAMES = 60
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

export interface LanServerOptions {
  /** IPv4 privada a la que se liga. */
  ip: string
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
  private peerCb: ((p: SignalingPeer) => void) | null = null
  private readonly sockets = new Set<WebSocket>()
  private readonly raw = new Set<Socket>()

  constructor(private readonly o: LanServerOptions) {}

  onPeer(cb: (peer: SignalingPeer) => void): void {
    this.peerCb = cb
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
    const preferred = this.o.preferredPort ?? null
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
    if (!preferred) this.o.onFirstPort?.(addr.port)
    this.host = `${this.o.ip}:${addr.port}`
    this.origin = `http://${this.host}`
    return { origin: this.origin }
  }

  async stop(): Promise<void> {
    const server = this.server
    const wss = this.wss
    this.server = null
    this.wss = null
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
    return {
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
        `connect-src 'self' ws://${this.host}`,
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
    if (!this.hostOk(req)) return send(421, 'Misdirected request')
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed')
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
    if (file !== root && !file.startsWith(root + sep)) return send(404, 'Not found')
    const type = MIME[extname(file).toLowerCase()]
    try {
      if (!type || !existsSync(file) || !statSync(file).isFile()) {
        if (pathname === '/index.html') return send(200, fallbackPage(), MIME['.html'])
        return send(404, 'Not found')
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
    let hello: SignalHello | null = null
    let offered = false
    let iceCount = 0
    let closedCb: (() => void) | null = null
    let offerCb: ((sdp: string) => void) | null = null
    let iceCb: ((c: string, mid: string) => void) | null = null
    let closed = false

    const send = (f: SignalHostFrame): void => {
      const s = encodeFrame(f)
      if (s && ws.readyState === ws.OPEN) ws.send(s)
    }
    const fail = (code: SignalErrorCode): void => {
      send({ t: 'error', code })
      ws.close(1008)
    }
    const timer = setTimeout(() => {
      if (!hello) ws.close(1008)
    }, HELLO_TIMEOUT_MS)

    const peer: SignalingPeer = {
      get hello() {
        return hello as SignalHello
      },
      sendAnswer: (sdp) => send({ t: 'answer', sdp }),
      sendIce: (candidate, mid) => send({ t: 'ice', candidate, mid }),
      onOffer: (cb) => void (offerCb = cb),
      onIce: (cb) => void (iceCb = cb),
      onClose: (cb) => void (closedCb = cb),
      close: () => {
        try {
          ws.close(1000)
        } catch {
          /* ya cerrado */
        }
      }
    }

    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (isBinary) return fail('frame')
      const parsed = parseSignalClientFrame(data.toString('utf8'))
      if (!parsed.ok) return fail('frame')
      const f = parsed.value
      if (!hello) {
        if (f.t !== 'hello') return fail('frame')
        if (f.v !== PROTOCOL_VERSION) return fail('version')
        // `authorize` consume el secreto de un solo uso aunque falle.
        let ok = false
        try {
          ok = opts.authorize(f)
        } catch {
          ok = false
        }
        if (!ok) return fail('invalid')
        hello = f
        clearTimeout(timer)
        send({ t: 'ready' })
        this.peerCb?.(peer)
        return
      }
      if (f.t === 'offer' && !offered) {
        offered = true
        offerCb?.(f.sdp)
      } else if (f.t === 'ice' && offered && iceCount++ < MAX_ICE_FRAMES) {
        iceCb?.(f.candidate, f.mid)
      } else {
        fail('frame')
      }
    })
    const onGone = (): void => {
      if (closed) return
      closed = true
      clearTimeout(timer)
      this.sockets.delete(ws)
      if (hello) closedCb?.()
    }
    ws.on('close', onGone)
    ws.on('error', onGone)
  }
}

function fallbackPage(): string {
  const msg = t('remote.pwa.missing')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>OnyxCode</title></head><body style="font-family:system-ui;padding:24px"><p>${msg.replace(/[<>&]/g, '')}</p></body></html>`
}
