/**
 * Control de red saliente de un servidor Tareas sandboxeado: dos servidores HTTP locales,
 * ambos en `127.0.0.1` con un puerto aleatorio libre por sesión.
 *
 * 1. `EgressProxy` — proxy HTTP(S) de reenvío (forward proxy) que el `opencode serve`
 *    sandboxeado usa vía `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`. Soporta `CONNECT` (túnel TCP
 *    en crudo para HTTPS: SIN inspeccionar el tráfico, sin descifrar TLS — más simple y más
 *    seguro que un MITM con CA propia) y peticiones HTTP planas. Exige
 *    `Proxy-Authorization: Basic <token>` (token aleatorio por sesión) para que otro proceso del
 *    mismo usuario en `127.0.0.1` no pueda usarlo sin conocerlo. Cada intento de conectar a un
 *    host fuera de la lista blanca se deniega, se registra y se emite como evento
 *    (`egress-blocked`) para que la UI ofrezca "Permitir esta vez / Permitir siempre".
 *
 * 2. `CredentialProxy` — proxy INVERSO (reverse proxy) de un único destino (la API del
 *    proveedor, p.ej. `https://opencode.ai/zen/go/v1`). El servidor sandboxeado nunca ve la
 *    clave real: su config apunta a `http://127.0.0.1:<puerto>/<token>` (el `baseURL` del
 *    proveedor en OpenCode admite una URL propia — `ProviderConfig.options.baseURL`) con una
 *    clave CENTINELA en `OPENCODE_AUTH_CONTENT`; este proxy verifica el `token` del path,
 *    lo quita, reenvía la petición por HTTPS a la API real y AÑADE el header `Authorization`
 *    real. La alternativa (interceptar TLS con una CA efímera igual que hacen otros clientes de referencia en
 *    su VM) exige instalar esa CA como confiable dentro del sandbox y descifrar todo el tráfico
 *    del proveedor; para un único destino conocido, un proxy inverso sin TLS interception logra
 *    lo mismo (la clave real nunca sale del proceso main) con muchísima menos superficie.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as netConnect, createServer as createNetServer, type Socket } from 'node:net'
import { getFreePort } from '../util/net'

export interface EgressBlockedEvent {
  host: string
  port: number
  at: number
  /** 'connect' = túnel HTTPS; 'http' = petición HTTP plana. */
  kind: 'connect' | 'http'
}

export interface EgressLogEntry extends EgressBlockedEvent {
  allowed: boolean
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** true si `host` está en la lista blanca (coincidencia exacta o subdominio de una entrada). */
export function hostAllowed(host: string, allowlist: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/\.$/, '')
  for (const entry of allowlist) {
    const e = entry.toLowerCase().replace(/^\*\./, '').replace(/\.$/, '')
    if (!e) continue
    if (h === e || h.endsWith(`.${e}`)) return true
  }
  return false
}

export interface EgressProxyOptions {
  /** Token para `Proxy-Authorization: Basic <base64(token:)>`. */
  token: string
  /** Lista blanca de hosts (mutable: se puede ampliar en caliente vía "Permitir siempre/una vez"). */
  allowlist: () => readonly string[]
  onBlocked?: (ev: EgressBlockedEvent) => void
  onLog?: (entry: EgressLogEntry) => void
}

export class EgressProxy {
  private server = createNetServer((socket) => this.handleConnection(socket))
  port = 0
  private readonly authHeader: string

  constructor(private opts: EgressProxyOptions) {
    this.authHeader = `Basic ${Buffer.from(`${opts.token}:`).toString('base64')}`
  }

  async start(): Promise<number> {
    this.port = await getFreePort()
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, '127.0.0.1', () => resolve(this.port))
    })
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  /** Maneja una conexión TCP entrante: parsea la primera línea de petición HTTP a mano
   * (evitamos `http.Server` para poder hacer `CONNECT` con socket en crudo sin que Node lo trate
   * como upgrade especial en todos los casos). */
  private handleConnection(socket: Socket): void {
    let buf = Buffer.alloc(0)
    let handled = false
    const onData = (chunk: Buffer): void => {
      if (handled) return
      buf = Buffer.concat([buf, chunk])
      const headerEnd = buf.indexOf('\r\n\r\n')
      if (headerEnd === -1) {
        if (buf.length > 64 * 1024) {
          socket.destroy()
        }
        return
      }
      handled = true
      socket.removeListener('data', onData)
      const headerText = buf.subarray(0, headerEnd).toString('utf8')
      const rest = buf.subarray(headerEnd + 4)
      this.processRequest(socket, headerText, rest)
    }
    socket.on('data', onData)
    socket.on('error', () => {
      // conexión abortada por el cliente: nada que hacer
    })
  }

  private processRequest(socket: Socket, headerText: string, leftover: Buffer): void {
    const lines = headerText.split('\r\n')
    const requestLine = lines[0] ?? ''
    const [method, target] = requestLine.split(' ')
    const headers = new Map<string, string>()
    for (const line of lines.slice(1)) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      headers.set(line.slice(0, idx).trim().toLowerCase(), line.slice(idx + 1).trim())
    }

    if (!this.checkAuth(headers)) {
      socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="onyxcode-egress"\r\nConnection: close\r\n\r\n'
      )
      return
    }

    if (method === 'CONNECT') {
      this.handleConnect(socket, target ?? '')
      return
    }
    this.handlePlainHttp(socket, method ?? '', target ?? '', headerText, leftover)
  }

  private checkAuth(headers: Map<string, string>): boolean {
    const auth = headers.get('proxy-authorization') ?? ''
    return timingSafeStringEqual(auth, this.authHeader)
  }

  private splitHostPort(hostport: string, defaultPort: number): { host: string; port: number } {
    const idx = hostport.lastIndexOf(':')
    if (idx === -1) return { host: hostport, port: defaultPort }
    const port = Number(hostport.slice(idx + 1))
    return { host: hostport.slice(0, idx), port: Number.isFinite(port) ? port : defaultPort }
  }

  private handleConnect(socket: Socket, target: string): void {
    const { host, port } = this.splitHostPort(target, 443)
    const allowed = hostAllowed(host, this.opts.allowlist())
    const entry: EgressLogEntry = { host, port, at: Date.now(), kind: 'connect', allowed }
    this.opts.onLog?.(entry)
    if (!allowed) {
      this.opts.onBlocked?.(entry)
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nHost not allowed by OnyxCode sandbox egress policy\r\n')
      return
    }
    const upstream = netConnect(port, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
    socket.on('close', () => upstream.destroy())
    upstream.on('close', () => socket.destroy())
  }

  private handlePlainHttp(socket: Socket, method: string, target: string, headerText: string, leftover: Buffer): void {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      return
    }
    const host = url.hostname
    const port = url.port ? Number(url.port) : 80
    const allowed = hostAllowed(host, this.opts.allowlist())
    const entry: EgressLogEntry = { host, port, at: Date.now(), kind: 'http', allowed }
    this.opts.onLog?.(entry)
    if (!allowed) {
      this.opts.onBlocked?.(entry)
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nHost not allowed by OnyxCode sandbox egress policy\r\n')
      return
    }
    const upstream = netConnect(port, host, () => {
      // Reescribe la línea de petición a forma "origin" (RFC 7230 §5.3.1) y reenvía cabeceras
      // salvo Proxy-Authorization/Proxy-Connection.
      const lines = headerText.split('\r\n')
      const [, , httpVer = 'HTTP/1.1'] = (lines[0] ?? '').split(' ')
      const originTarget = `${url.pathname}${url.search}`
      const outHeaders = lines.slice(1).filter((l) => !/^proxy-(authorization|connection):/i.test(l))
      const out = [`${method} ${originTarget} ${httpVer}`, ...outHeaders, '', ''].join('\r\n')
      upstream.write(out)
      if (leftover.length) upstream.write(leftover)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  }
}

export interface CredentialProxyOptions {
  /** Token secreto en el path (`/<token>/...`) que valida que la petición viene del proceso hijo. */
  token: string
  /** Origen real (p.ej. `https://opencode.ai`). */
  targetOrigin: string
  /** Prefijo a anteponer al path reenviado (p.ej. `/zen/go/v1`). */
  targetPathPrefix?: string
  /** Header Authorization REAL a inyectar (p.ej. `Bearer sk-...`). Nunca se expone al sandbox. */
  authorization: string
}

/** Proxy inverso de un único destino que inyecta la clave real del proveedor. */
export class CredentialProxy {
  private server = createHttpServer((req, res) => this.handle(req, res))
  port = 0

  constructor(private opts: CredentialProxyOptions) {}

  async start(): Promise<number> {
    this.port = await getFreePort()
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(this.port, '127.0.0.1', () => resolve(this.port))
    })
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.server.close(() => resolve()))
  }

  /** `http://127.0.0.1:<port>/<token>` — usar como `baseURL` del proveedor. */
  baseUrl(): string {
    return `http://127.0.0.1:${this.port}/${this.opts.token}`
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/'
    const prefix = `/${this.opts.token}`
    if (!url.startsWith(prefix)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
      return
    }
    const rest = url.slice(prefix.length) || '/'
    const target = new URL(`${this.opts.targetOrigin}${this.opts.targetPathPrefix ?? ''}${rest}`)
    const isHttps = target.protocol === 'https:'
    const headers: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v === undefined) continue
      const lk = k.toLowerCase()
      if (lk === 'host' || lk === 'authorization' || lk === 'connection') continue
      headers[k] = v
    }
    headers.host = target.host
    headers.authorization = this.opts.authorization

    const fn = isHttps ? httpsRequest : httpRequest
    const upstream = fn(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
        upstreamRes.pipe(res)
      }
    )
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end(`credential-proxy upstream error: ${err.message}`)
    })
    req.pipe(upstream)
  }
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}
