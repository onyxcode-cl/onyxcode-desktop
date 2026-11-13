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
import { isUnifiedAppsEnabled } from '@shared/unified-bridge'
import { getBridgeSecret } from './bridge-secret'
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
import { parseStrictJson, StrictJsonError } from './strict-json'

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
  /**
   * Solo se reenvía la ruta exacta de `url` (sin subrutas): el cliente no puede pedir otra ruta del mismo servidor (puente de apps del
   * modo unificado). Cualquier otra ruta → 404.
   */
  exactPath?: boolean
  /**
   * Espera máxima hasta las cabeceras del destino para ESTA ruta (por defecto, `limits.headersTimeoutMs`). La usa `equipo`, que espera a
   * que la persona apruebe en main antes de responder.
   */
  headersTimeoutMs?: number
  /**
   * Puerta de main para las llamadas a herramientas (`tools/call`) de esta ruta (conectores de la persona con «preguntar cada herramienta»).
   * Con ella, el cuerpo de cada POST se lee ENTERO antes de reenviarlo: si trae un `tools/call`, main decide; lo que se reenvía es
   * exactamente lo que se revisó. Un cuerpo que no se entiende (no es JSON, o un lote con más de una llamada) se rechaza sin reenviar.
   */
  toolCallGate?: ToolCallGate
}

/** Una llamada a herramienta vista en el cuerpo JSON-RPC. `args` tal cual llegó. */
export interface ToolCall {
  tool: string
  args: unknown
}
/** `ok` = se reenvía; si no, `message` vuelve al cliente como resultado de error de la herramienta (sin tocar el servidor de destino). */
export type ToolCallVerdict = { ok: true } | { ok: false; message: string }
export type ToolCallGate = (call: ToolCall, signal: AbortSignal) => Promise<ToolCallVerdict>

type ParsedBody =
  { kind: 'none'; canonical: Buffer } | { kind: 'call'; call: ToolCall; id: unknown; canonical: Buffer } | { kind: 'bad'; why: string }

/** Claves de un mensaje JSON-RPC: solo estas, en su forma exacta. */
const MESSAGE_KEYS = new Set(['jsonrpc', 'id', 'method', 'params', 'result', 'error'])
/** Claves de `params` por método conocido (forma exacta). Un método fuera de la tabla no se revisa aquí. */
const PARAM_KEYS: Record<string, ReadonlySet<string>> = {
  'tools/call': new Set(['name', 'arguments', '_meta', 'task']),
  initialize: new Set(['protocolVersion', 'capabilities', 'clientInfo', '_meta']),
  ping: new Set(['_meta']),
  'tools/list': new Set(['cursor', '_meta']),
  'resources/list': new Set(['cursor', '_meta']),
  'resources/templates/list': new Set(['cursor', '_meta']),
  'prompts/list': new Set(['cursor', '_meta']),
  'resources/read': new Set(['uri', '_meta']),
  'prompts/get': new Set(['name', 'arguments', '_meta']),
  'notifications/initialized': new Set(['_meta']),
  'notifications/cancelled': new Set(['requestId', 'reason', '_meta']),
  'notifications/progress': new Set(['progressToken', 'progress', 'total', 'message', '_meta']),
  'notifications/roots/list_changed': new Set(['_meta'])
}

/** Métodos de solo protocolo: pasan sin preguntar (no leen ni hacen nada con la cuenta de la persona). */
const PROTOCOL_METHODS = new Set([
  'initialize',
  'ping',
  'tools/list',
  'resources/list',
  'resources/templates/list',
  'prompts/list',
  'notifications/initialized',
  'notifications/cancelled',
  'notifications/progress',
  'notifications/roots/list_changed'
])
/** Métodos que pasan por la tarjeta de main. */
const GATED_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get'])

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Busca la llamada que necesita a la persona (`tools/call`, `resources/read` o `prompts/get`) en un cuerpo JSON-RPC (mensaje o lote) y devuelve lo que se reenviará (`canonical` = `JSON.stringify` de lo
 * revisado). `bad` (no se reenvía): JSON inválido, claves repetidas o equivalentes en cualquier objeto (`strict-json.ts`), claves que no
 * son las del mensaje JSON-RPC o las de los `params` de un método conocido, un método que no es de protocolo ni de la puerta, o más de
 * una llamada en un lote.
 */
export function findToolCall(body: Buffer): ParsedBody {
  if (body.length === 0) return { kind: 'none', canonical: body }
  let parsed: unknown
  try {
    parsed = parseStrictJson(body.toString('utf8'))
  } catch (err) {
    return { kind: 'bad', why: err instanceof StrictJsonError ? err.message : 'not-json' }
  }
  const list = Array.isArray(parsed) ? parsed : [parsed]
  if (list.length === 0) return { kind: 'bad', why: 'empty-batch' }
  for (const m of list) {
    if (!isPlainObject(m)) return { kind: 'bad', why: 'shape' }
    for (const k of Object.keys(m)) if (!MESSAGE_KEYS.has(k)) return { kind: 'bad', why: `key:${k}` }
    if ('jsonrpc' in m && m.jsonrpc !== '2.0') return { kind: 'bad', why: 'jsonrpc' }
    if ('method' in m && typeof m.method !== 'string') return { kind: 'bad', why: 'method' }
    if ('params' in m && m.params !== undefined && !isPlainObject(m.params) && !Array.isArray(m.params))
      return { kind: 'bad', why: 'params' }
    const allowed = typeof m.method === 'string' ? PARAM_KEYS[m.method] : undefined
    if (allowed && isPlainObject(m.params)) {
      for (const k of Object.keys(m.params)) if (!allowed.has(k)) return { kind: 'bad', why: `param:${k}` }
    }
    if (allowed && Array.isArray(m.params)) return { kind: 'bad', why: 'params' }
  }
  // C3: solo pasan sin preguntar los métodos de protocolo y las respuestas del cliente (sin `method`); los que leen o hacen algo con la
  // identidad de la persona (`tools/call`, `resources/read`, `prompts/get`) pasan por la puerta; cualquier otro método no se reenvía.
  for (const m of list as Array<Record<string, unknown>>) {
    if (typeof m.method === 'string' && !PROTOCOL_METHODS.has(m.method) && !GATED_METHODS.has(m.method)) {
      return { kind: 'bad', why: `method:${m.method}` }
    }
  }
  const canonical = Buffer.from(JSON.stringify(parsed), 'utf8')
  const calls = (list as Array<Record<string, unknown>>).filter((m) => typeof m.method === 'string' && GATED_METHODS.has(m.method))
  if (calls.length === 0) return { kind: 'none', canonical }
  if (calls.length > 1) return { kind: 'bad', why: 'batch' }
  const m = calls[0]!
  const params = isPlainObject(m.params) ? m.params : {}
  if (m.method === 'resources/read') {
    if (typeof params.uri !== 'string' || !params.uri) return { kind: 'bad', why: 'no-uri' }
    // Lo que ve la persona: que es una LECTURA y de qué recurso; la memoria de «mientras siga abierta» queda atada a ese recurso exacto.
    return { kind: 'call', call: { tool: `resources/read ${params.uri}`, args: { uri: params.uri } }, id: m.id ?? null, canonical }
  }
  if (typeof params.name !== 'string' || !params.name) return { kind: 'bad', why: 'no-name' }
  if (m.method === 'prompts/get') {
    return { kind: 'call', call: { tool: `prompts/get ${params.name}`, args: params.arguments ?? {} }, id: m.id ?? null, canonical }
  }
  return { kind: 'call', call: { tool: params.name, args: params.arguments ?? {} }, id: m.id ?? null, canonical }
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
  exactPath: boolean
  headersTimeoutMs?: number
  toolCallGate?: ToolCallGate
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
  // El secreto del puente de apps solo existe (y solo se crea) con la bandera encendida: el redactor de Diagnóstico lo oculta.
  return isUnifiedAppsEnabled() ? [...issuedTokens, getBridgeSecret()] : [...issuedTokens]
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
  private localPost: {
    path: string
    hash: Buffer
    handler: (body: unknown, signal: AbortSignal, ticket?: string) => Promise<unknown>
    acceptsTicket?: (ticket: string) => boolean
  } | null = null
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
    this.localPost = null
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
      exactPath: spec.exactPath === true,
      headersTimeoutMs:
        typeof spec.headersTimeoutMs === 'number' && Number.isFinite(spec.headersTimeoutMs) && spec.headersTimeoutMs > 0
          ? spec.headersTimeoutMs
          : undefined,
      toolCallGate: typeof spec.toolCallGate === 'function' ? spec.toolCallGate : undefined,
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

  /** Mutación local acotada, con token DISTINTO del guardián de solo lectura. Sin destinos elegibles por el cliente. */
  setLocalPostHandler(
    path: string,
    handler: (body: unknown, signal: AbortSignal, ticket?: string) => Promise<unknown>,
    acceptsTicket?: (ticket: string) => boolean
  ): { url: string; token: string } {
    if (!this.server || !/^\/[A-Za-z0-9_-]+$/.test(path)) throw new Error('Ruta local no válida.')
    const token = randomBytes(32).toString('base64url')
    this.localPost = { path, hash: sha256(token), handler, acceptsTicket }
    issuedTokens.push(token)
    if (issuedTokens.length > 512) issuedTokens.splice(0, issuedTokens.length - 512)
    return { url: `http://${HOST}:${this.port}${path}`, token }
  }

  private async handleLocalPost(req: IncomingMessage, res: ServerResponse, ticket?: string): Promise<void> {
    const local = this.localPost!
    if (req.url !== local.path) return this.reply(res, 404, 'not found')
    if (req.method !== 'POST') return this.reply(res, 405, 'method not allowed', { allow: 'POST' })
    if (this.total >= this.limits.maxConcurrent) return this.reply(res, 429, 'too many requests')
    this.total++
    const chunks: Buffer[] = []
    let size = 0
    const controller = new AbortController()
    req.once('aborted', () => controller.abort())
    res.once('close', () => controller.abort())
    req.setTimeout(5000, () => req.destroy())
    try {
      for await (const chunk of req) {
        size += chunk.length
        if (size > 20000) return this.reply(res, 413, 'too large')
        chunks.push(Buffer.from(chunk))
      }
      const body = parseStrictJson(Buffer.concat(chunks).toString('utf8'))
      if (this.localPost !== local) return this.reply(res, 401, 'unauthorized')
      const result = await (ticket === undefined ? local.handler(body, controller.signal) : local.handler(body, controller.signal, ticket))
      if (!res.destroyed)
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(result))
    } catch {
      this.reply(res, 502, 'cleanup failed')
    } finally {
      this.total--
    }
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
    if (this.localPost && token && timingSafeEqual(sha256(token), this.localPost.hash)) {
      void this.handleLocalPost(req, res)
      return
    }
    // Billete de una sola llamada: solo la ruta local exacta; nunca concede rutas MCP ni el canal GET.
    if (this.localPost && req.url === this.localPost.path && token && this.localPost.acceptsTicket?.(token)) {
      void this.handleLocalPost(req, res, token)
      return
    }
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
    if (route.exactPath && path !== route.basePath) {
      if (route.toolCallGate) {
        log(
          route.name,
          'petición a otra ruta del conector rechazada: con «preguntar cada herramienta» solo se usa la ruta exacta del conector. ' +
            'Si este conector usa el transporte SSE antiguo (POST a /messages), con «preguntar» no funciona en Tareas aisladas: usa ' +
            'su dirección «streamable HTTP» o quita «preguntar»'
        )
      }
      return this.reply(res, 404, 'not found')
    }
    // Ruta con puerta: solo POST lleva cuerpo (y se revisa). GET únicamente para el flujo de eventos y DELETE para cerrar la sesión,
    // los dos sin cuerpo: un cuerpo ahí llegaría al servicio sin pasar por la puerta.
    if (route.toolCallGate && method !== 'POST') {
      const cl = req.headers['content-length']
      if ((cl !== undefined && cl !== '0') || req.headers['transfer-encoding'] !== undefined)
        return this.reply(res, 400, 'body not allowed')
      const accept = String(req.headers.accept ?? '')
      if (method === 'GET' && !accept.toLowerCase().includes('text/event-stream')) return this.reply(res, 406, 'only event stream')
    }
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

    const gate = route.toolCallGate
    if (gate && method === 'POST') {
      // Un cuerpo comprimido no se puede revisar: no se reenvía (y `content-encoding` del cliente nunca pasa al destino).
      const enc = req.headers['content-encoding']
      if (enc !== undefined && String(enc).trim().toLowerCase() !== 'identity') {
        release()
        return this.reply(res, 415, 'encoded body not allowed')
      }
      // Se lee entero (con el mismo tope), se revisa y se reenvía ESE mismo cuerpo, o se responde sin tocar el destino.
      const chunks: Buffer[] = []
      let size = 0
      let tooBig = false
      const aborter = new AbortController()
      res.once('close', () => {
        if (!res.writableFinished) aborter.abort()
        release()
      })
      req.on('data', (c: Buffer) => {
        if (tooBig) return
        size += c.length
        if (size > this.limits.maxBodyBytes) {
          tooBig = true
          chunks.length = 0
          this.reply(res, 413, 'too large')
          req.destroy()
          return
        }
        chunks.push(c)
      })
      req.once('error', () => aborter.abort())
      req.once('end', () => {
        if (tooBig || res.writableEnded) return
        const body = Buffer.concat(chunks)
        const found = findToolCall(body)
        if (found.kind === 'bad') {
          log(route.name, 'cuerpo no revisable, no se reenvía', found.why)
          return this.reply(res, 400, 'request not allowed')
        }
        // Se reenvía SIEMPRE lo revisado, reescrito (`canonical`), nunca los bytes originales.
        if (found.kind === 'none') return this.forward(req, res, route, target, search, method, headers, release, found.canonical)
        void gate(found.call, aborter.signal)
          .catch((): ToolCallVerdict => ({ ok: false, message: 'No se pudo pedir la aprobación.' }))
          .then((v) => {
            if (res.writableEnded || res.destroyed || aborter.signal.aborted) return
            if (v.ok) return this.forward(req, res, route, target, search, method, headers, release, found.canonical)
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
            res.end(
              JSON.stringify({ jsonrpc: '2.0', id: found.id, result: { content: [{ type: 'text', text: v.message }], isError: true } })
            )
          })
      })
      return
    }
    this.forward(req, res, route, target, search, method, headers, release)
  }

  /** Reenvía al destino: el cuerpo ya leído (`body`, ruta con puerta) o el del cliente tal como llega. */
  private forward(
    req: IncomingMessage,
    res: ServerResponse,
    route: Route,
    target: URL,
    search: string,
    method: string,
    headers: Record<string, string | string[]>,
    release: () => void,
    body?: Buffer
  ): void {
    if (body) headers['content-length'] = String(body.length)
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
    upstream.setTimeout(route.headersTimeoutMs ?? this.limits.headersTimeoutMs, () => {
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

    if (body) {
      upstream.end(body)
      return
    }
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
