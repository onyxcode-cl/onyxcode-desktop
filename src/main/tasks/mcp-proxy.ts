/**
 * Proxy local de MCP FUERA del sandbox de Tareas (F8-B79, hallazgo 6 de F8-B69).
 *
 * Problema verificado: dentro de Seatbelt el agente puede leer el entorno de `opencode serve` (`ps eww`,
 * `sysctl kern.procargs2`; ninguna regla del perfil lo impide), y ahí vivía `OPENCODE_CONFIG_CONTENT` con el
 * token del MCP del navegador y las cabeceras de los MCP remotos del usuario.
 *
 * Solución (análoga a `CredentialProxy` de la clave del proveedor): este servidor corre en el proceso main, en
 * `127.0.0.1` con puerto aleatorio. El servidor de Tareas recibe en su configuración MCP solo
 * `http://127.0.0.1:<puerto><ruta>` y un token de SESIÓN (`Authorization: Bearer <sesión>`): uno por servidor MCP
 * (alcance mínimo: sirve para ese único destino), con caducidad y revocable. Al reenviar, el proxy QUITA esa
 * cabecera y pone las cabeceras reales configuradas por el usuario; los secretos reales nunca llegan al entorno,
 * a los argumentos ni a la configuración del proceso del sandbox.
 *
 * Reglas (todas con prueba en `mcp-proxy.test.ts`):
 * - Lista cerrada de destinos: el origen (`esquema://host:puerto`) sale SOLO de la ruta registrada por main. El
 *   cliente nunca elige host: una petición en forma absoluta (`GET http://otro/`), `..`, `//`, `%2f`, `\`, `#`…
 *   se rechazan (`safeUpstreamRest`). No se siguen redirecciones: un 3xx del destino se convierte en 502.
 * - Token en tiempo constante (se comparan hashes de longitud fija contra TODAS las rutas, sin salir antes);
 *   caduca (`ttlMs`) y se revoca (`revokeRoute`/`stop`). 401 idéntico para ausente/erróneo/caducado/revocado.
 * - Solo `Host: 127.0.0.1:<puerto>`/`localhost:<puerto>` (anti rebinding), nunca `Origin`, solo GET/POST/DELETE.
 * - Cabeceras del cliente en lista cerrada; el proxy añade las reales. Cabeceras de respuesta en lista cerrada
 *   (sin `set-cookie`, sin `location`).
 * - Límites: cuerpo de petición, peticiones simultáneas (total y por ruta), tiempo hasta las cabeceras y de
 *   inactividad del flujo.
 * - No registra secretos: solo el nombre de la ruta y el estado.
 * - `stop()` cierra el servidor, destruye conexiones y peticiones al destino y borra las rutas.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  createServer as createHttpServer,
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import { request as httpsRequest } from 'node:https'
import { getFreePort } from '../util/net'
import { safeUpstreamRest } from './proxy'

const HOST = '127.0.0.1'

export interface McpProxyLimits {
  /** Vida máxima de un token de sesión. */
  ttlMs: number
  /** Tamaño máximo del cuerpo de una petición. */
  maxBodyBytes: number
  /** Peticiones simultáneas (incluye flujos SSE abiertos). */
  maxConcurrent: number
  maxConcurrentPerRoute: number
  /** Tiempo máximo hasta recibir las cabeceras del destino. */
  headersTimeoutMs: number
  /** Inactividad máxima de un flujo ya iniciado. */
  idleTimeoutMs: number
}

export const DEFAULT_MCP_PROXY_LIMITS: McpProxyLimits = {
  ttlMs: 12 * 60 * 60 * 1000,
  maxBodyBytes: 8 * 1024 * 1024,
  maxConcurrent: 32,
  maxConcurrentPerRoute: 16,
  headersTimeoutMs: 120_000,
  idleTimeoutMs: 15 * 60 * 1000
}

export interface McpRouteSpec {
  /** Nombre del servidor MCP (solo para registro y mensajes). */
  name: string
  /** URL real del servidor MCP remoto (http/https). */
  url: string
  /** Cabeceras REALES a inyectar (secretas). */
  headers?: Record<string, string>
}

/** Lo que recibe el servidor del sandbox: nunca contiene el secreto real. */
export interface McpRouteClientConfig {
  /** `http://127.0.0.1:<puerto><ruta del destino>`; la consulta del destino NO se expone (puede llevar claves). */
  url: string
  /** `{ Authorization: 'Bearer <token de sesión>' }`. */
  headers: Record<string, string>
  token: string
}

interface Route {
  name: string
  origin: string
  basePath: string
  query: URLSearchParams
  injected: Array<[string, string]>
  hash: Buffer
  expiresAt: number
  revoked: boolean
  inflight: number
}

const CLIENT_HEADERS = new Set(['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id', 'user-agent'])
const RESPONSE_HEADERS = new Set([
  'content-type',
  'content-encoding',
  'content-length',
  'cache-control',
  'mcp-session-id',
  'mcp-protocol-version',
  'retry-after',
  'www-authenticate'
])
/** Cabeceras que la ruta no puede fijar (las gestiona el propio transporte). */
const FORBIDDEN_INJECTED = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'te', 'trailer', 'keep-alive'])
const HEADER_NAME_RE = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
const CONTROL_RE = /[\u0000-\u001f\u007f]/
const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE'])

const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest()

/** Todos los tokens de sesión emitidos en esta vida de la app (acotado): el redactor de Diagnóstico los oculta. */
const issuedTokens: string[] = []
export function knownMcpProxyTokens(): string[] {
  return [...issuedTokens]
}

function log(...a: unknown[]): void {
  console.log('[tasks-mcp-proxy]', ...a.map(String))
}

/**
 * Manejador LOCAL de solo lectura servido en el mismo puerto (F8-B208, canal del guardián de subagentes): lo atiende
 * main, no se reenvía a ningún destino. Recibe la ruta tras el prefijo y la consulta; devuelve estado y cuerpo JSON.
 */
export type McpProxyLocalHandler = (path: string, query: URLSearchParams) => Promise<{ status: number; body: unknown }>
/** Longitud máxima de la URL de una petición al manejador local. */
const LOCAL_MAX_URL = 512

export class McpProxy {
  private readonly limits: McpProxyLimits
  private readonly now: () => number
  private server: Server | null = null
  private routes: Route[] = []
  private local: { prefix: string; hash: Buffer; handler: McpProxyLocalHandler } | null = null
  private total = 0
  private readonly upstreams = new Set<ClientRequest>()
  port = 0

  constructor(opts: { limits?: Partial<McpProxyLimits>; now?: () => number } = {}) {
    this.limits = { ...DEFAULT_MCP_PROXY_LIMITS, ...opts.limits }
    this.now = opts.now ?? Date.now
  }

  async start(): Promise<number> {
    if (this.server) return this.port
    const port = await getFreePort(HOST)
    const server = createHttpServer((req, res) => {
      try {
        this.handle(req, res)
      } catch (err) {
        log('error', err instanceof Error ? err.name : 'desconocido')
        if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
        res.end('error')
      }
    })
    server.requestTimeout = 0
    server.headersTimeout = 30_000
    server.keepAliveTimeout = 30_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, HOST, () => resolve())
    })
    this.server = server
    this.port = port
    return port
  }

  /** Cierra el servidor, corta toda conexión y petición al destino y olvida las rutas (los tokens dejan de valer). */
  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    for (const r of this.routes) r.revoked = true
    this.routes = []
    this.local = null
    for (const u of this.upstreams) u.destroy()
    this.upstreams.clear()
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  /** Registra un destino y devuelve lo que se entrega al sandbox. Lanza si la URL o las cabeceras no son válidas. */
  addRoute(spec: McpRouteSpec): McpRouteClientConfig {
    if (!this.server) throw new Error('El proxy MCP no está activo.')
    let url: URL
    try {
      url = new URL(spec.url)
    } catch {
      throw new Error(`URL inválida para el MCP "${spec.name}".`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`Esquema no permitido para el MCP "${spec.name}".`)
    const injected: Array<[string, string]> = []
    for (const [k, v] of Object.entries(spec.headers ?? {})) {
      const name = k.trim()
      if (!HEADER_NAME_RE.test(name) || typeof v !== 'string' || CONTROL_RE.test(v)) {
        throw new Error(`Cabecera no válida en el MCP "${spec.name}".`)
      }
      if (FORBIDDEN_INJECTED.has(name.toLowerCase())) continue
      injected.push([name, v])
    }
    // Credenciales en la URL (`https://u:p@host`) → cabecera Basic (Node no las envía por su cuenta).
    if ((url.username || url.password) && !injected.some(([k]) => k.toLowerCase() === 'authorization')) {
      const basic = Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')
      injected.push(['Authorization', `Basic ${basic}`])
    }
    const token = randomBytes(32).toString('base64url')
    issuedTokens.push(token)
    if (issuedTokens.length > 512) issuedTokens.splice(0, issuedTokens.length - 512)
    const basePath = url.pathname || '/'
    this.routes.push({
      name: spec.name,
      origin: url.origin,
      basePath,
      query: new URLSearchParams(url.search),
      injected,
      hash: sha256(token),
      expiresAt: this.now() + this.limits.ttlMs,
      revoked: false,
      inflight: 0
    })
    return { url: `http://${HOST}:${this.port}${basePath}`, headers: { Authorization: `Bearer ${token}` }, token }
  }

  /**
   * Registra el manejador local (uno por proxy) bajo `prefix` y devuelve su URL base y su token (aleatorio, solo en
   * memoria; se compara en tiempo constante). Solo GET, sin cuerpo, URL acotada; nunca se reenvía a otro destino.
   */
  setLocalHandler(prefix: string, handler: McpProxyLocalHandler): { url: string; token: string } {
    if (!this.server) throw new Error('El proxy MCP no está activo.')
    if (!/^\/[A-Za-z0-9_-]+$/.test(prefix)) throw new Error('Prefijo local no válido.')
    const token = randomBytes(32).toString('base64url')
    issuedTokens.push(token)
    if (issuedTokens.length > 512) issuedTokens.splice(0, issuedTokens.length - 512)
    this.local = { prefix, hash: sha256(token), handler }
    return { url: `http://${HOST}:${this.port}${prefix}`, token }
  }

  private handleLocal(req: IncomingMessage, res: ServerResponse): void {
    const local = this.local!
    if (req.method !== 'GET') return this.reply(res, 405, 'method not allowed', { allow: 'GET' })
    const raw = req.url ?? ''
    if (raw.length > LOCAL_MAX_URL) return this.reply(res, 414, 'uri too long')
    const declared = Number(req.headers['content-length'] ?? 0)
    if (declared > 0 || req.headers['transfer-encoding'] !== undefined) return this.reply(res, 413, 'too large')
    if (raw !== local.prefix && !raw.startsWith(local.prefix + '/') && !raw.startsWith(local.prefix + '?')) {
      return this.reply(res, 404, 'not found')
    }
    const rest = raw.slice(local.prefix.length)
    const q = rest.indexOf('?')
    const path = q === -1 ? rest : rest.slice(0, q)
    if (!/^\/[a-z]{1,32}$/.test(path)) return this.reply(res, 404, 'not found')
    if (this.total >= this.limits.maxConcurrent) return this.reply(res, 429, 'too many requests', { 'retry-after': '1' })
    this.total++
    let released = false
    const release = (): void => {
      if (!released) {
        released = true
        this.total--
      }
    }
    res.once('close', release)
    local
      .handler(path, new URLSearchParams(q === -1 ? '' : rest.slice(q + 1)))
      .then(
        (r) => {
          if (res.headersSent || res.destroyed) return
          res.writeHead(r.status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(r.body))
        },
        () => this.reply(res, 502, 'error')
      )
      .finally(release)
  }

  /** Revoca la ruta de ese nombre (su token deja de valer). `false` si no existía. */
  revokeRoute(name: string): boolean {
    let any = false
    for (const r of this.routes) {
      if (r.name === name && !r.revoked) {
        r.revoked = true
        any = true
      }
    }
    return any
  }

  routeCount(): number {
    return this.routes.filter((r) => !r.revoked).length
  }

  /** Busca la ruta del token en tiempo constante: hashes de 32 bytes contra TODAS las rutas, sin salir antes. */
  private lookup(token: string | undefined): Route | null {
    const h = sha256(token ?? '')
    let found: Route | null = null
    for (const r of this.routes) {
      if (timingSafeEqual(h, r.hash) && token) found = r
    }
    if (!found || found.revoked || this.now() >= found.expiresAt) return null
    return found
  }

  private reply(res: ServerResponse, status: number, text: string, extra: Record<string, string> = {}): void {
    if (res.headersSent) {
      res.destroy()
      return
    }
    res.writeHead(status, { 'content-type': 'text/plain', 'cache-control': 'no-store', ...extra }).end(text)
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const host = req.headers.host ?? ''
    if (host !== `${HOST}:${this.port}` && host !== `localhost:${this.port}`) return this.reply(res, 403, 'bad host')
    // Un navegador (o una página dentro del sandbox) nunca debe poder usar este puerto con CORS.
    if (req.headers.origin !== undefined) return this.reply(res, 403, 'origin not allowed')
    const auth = req.headers.authorization
    const token = typeof auth === 'string' && /^Bearer /.test(auth) ? auth.slice(7) : undefined
    // Manejador local (canal del guardián): mismo Host/Origin, su propio token en tiempo constante.
    if (this.local && token && timingSafeEqual(sha256(token), this.local.hash)) return this.handleLocal(req, res)
    const route = this.lookup(token)
    if (!route) return this.reply(res, 401, 'unauthorized', { 'www-authenticate': 'Bearer' })
    const method = req.method ?? ''
    if (!ALLOWED_METHODS.has(method)) return this.reply(res, 405, 'method not allowed', { allow: 'GET, POST, DELETE' })
    const rest = safeUpstreamRest(req.url ?? '/')
    if (rest === null) return this.reply(res, 400, 'bad path')
    const q = rest.indexOf('?')
    const path = q === -1 ? rest : rest.slice(0, q)
    const clientQuery = new URLSearchParams(q === -1 ? '' : rest.slice(q + 1))
    let target: URL
    try {
      target = new URL(`${route.origin}${path}`)
    } catch {
      return this.reply(res, 400, 'bad path')
    }
    // Defensa en profundidad: tras normalizar, el destino sigue siendo el origen registrado.
    if (target.origin !== route.origin || target.username || target.password) return this.reply(res, 400, 'bad path')
    // La consulta registrada (puede llevar claves) manda sobre la del cliente.
    const merged = new URLSearchParams(clientQuery)
    for (const k of new Set(route.query.keys())) merged.delete(k)
    for (const [k, v] of route.query) merged.append(k, v)
    const search = merged.toString()

    const declared = Number(req.headers['content-length'] ?? 0)
    if (Number.isFinite(declared) && declared > this.limits.maxBodyBytes) return this.reply(res, 413, 'too large')
    if (this.total >= this.limits.maxConcurrent || route.inflight >= this.limits.maxConcurrentPerRoute) {
      return this.reply(res, 429, 'too many requests', { 'retry-after': '1' })
    }
    this.total++
    route.inflight++
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.total--
      route.inflight--
    }

    const headers: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined && CLIENT_HEADERS.has(k.toLowerCase())) headers[k.toLowerCase()] = v
    }
    // Las reales sustituyen a cualquier cabecera del cliente del mismo nombre (sin distinguir mayúsculas).
    for (const [k, v] of route.injected) {
      for (const existing of Object.keys(headers)) if (existing.toLowerCase() === k.toLowerCase()) delete headers[existing]
      headers[k] = v
    }
    headers.host = target.host

    const isHttps = target.protocol === 'https:'
    let upstream: ClientRequest
    try {
      upstream = (isHttps ? httpsRequest : httpRequest)({
        protocol: target.protocol,
        hostname: target.hostname.replace(/^\[|\]$/g, ''),
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${search ? `?${search}` : ''}`,
        method,
        headers,
        agent: false
      })
    } catch {
      release()
      return this.reply(res, 502, 'bad upstream request')
    }
    this.upstreams.add(upstream)
    const done = (): void => {
      this.upstreams.delete(upstream)
      release()
    }
    res.once('close', () => {
      upstream.destroy()
      done()
    })
    upstream.setTimeout(this.limits.headersTimeoutMs, () => {
      if (!res.headersSent) this.reply(res, 504, 'upstream timeout')
      upstream.destroy()
    })
    upstream.once('response', (up) => {
      const status = up.statusCode ?? 502
      if (status >= 300 && status < 400) {
        up.resume()
        log(route.name, 'redirección rechazada', status)
        return this.reply(res, 502, 'redirects are not followed')
      }
      const out: Record<string, string | string[]> = {}
      for (const [k, v] of Object.entries(up.headers)) {
        if (v !== undefined && RESPONSE_HEADERS.has(k.toLowerCase())) out[k] = v
      }
      upstream.setTimeout(this.limits.idleTimeoutMs, () => {
        upstream.destroy()
        res.destroy()
      })
      res.writeHead(status, out)
      up.pipe(res)
      up.once('error', () => res.destroy())
    })
    upstream.once('error', () => {
      done()
      if (!res.headersSent) this.reply(res, 502, 'upstream error')
      else res.destroy()
    })

    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > this.limits.maxBodyBytes) {
        upstream.destroy()
        this.reply(res, 413, 'too large')
        req.destroy()
      }
    })
    req.once('error', () => upstream.destroy())
    req.pipe(upstream)
  }
}
