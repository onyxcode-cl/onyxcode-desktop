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
import { lookup } from 'node:dns/promises'
import { connect as netConnect, createServer as createNetServer, isIP, type Socket } from 'node:net'
import { networkInterfaces } from 'node:os'
import { isLocalHostname } from '../embedded-browser/ip-class'
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

/**
 * Puertos de destino que el proxy de salida acepta. Todo lo que hoy sale por él es HTTPS (API de modelos, búsqueda web, npm, PyPI, git por
 * https) o HTTP plano: 443 y 80. Cualquier otro puerto (bases de datos, SSH, paneles de administración) se niega aunque el nombre esté permitido.
 */
export const EGRESS_ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443])

/**
 * Direcciones de metadatos de nube que NO caen en las clases generales de `isLocalHostname` (las de 169.254/16, 100.64/10, 192.0.0/24 y
 * fd00::/8 ya están cubiertas). Idea tomada de `anthropics/sandbox-runtime` (`resolved-address-guard.ts`, Apache-2.0); código propio.
 */
const EXTRA_DENIED = new Set(['168.63.129.16']) // Azure WireServer

/** Quita corchetes y zona (`%en0`) y desmapea `::ffff:a.b.c.d` / `::ffff:7f00:1` a IPv4 para comparar direcciones entre sí. */
function canonicalIp(ip: string): string {
  let a = ip
    .toLowerCase()
    .trim()
    .replace(/^\[|\]$/g, '')
  const zone = a.indexOf('%')
  if (zone >= 0) a = a.slice(0, zone)
  const mapped = /^(?:::|(?:0{1,4}:){5})ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a)
  if (mapped) return mapped[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(a)
  if (hex) {
    const hi = parseInt(hex[1], 16)
    const lo = parseInt(hex[2], 16)
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`
  }
  return a
}

/** Direcciones asignadas ahora mismo a las interfaces de este equipo (se leen en cada consulta: cambian al cambiar de red). */
export function localInterfaceAddresses(): string[] {
  try {
    return Object.values(networkInterfaces())
      .flat()
      .filter((i): i is NonNullable<typeof i> => !!i)
      .map((i) => i.address)
  } catch {
    return [] // sin enumeración de interfaces: siguen valiendo las clases fijas
  }
}

/**
 * ¿Es una dirección a la que el sandbox NUNCA debe llegar por el proxy aunque el nombre esté permitido? Se niega por defecto todo lo que no
 * sea Internet pública: loopback (el puerto del propio motor, el del proxy MCP, el del proxy de claves y cualquier servicio local), «esta
 * máquina» (0.0.0.0/8 y ::), redes privadas (10/8, 172.16/12, 192.168/16: el router, el NAS, bases de datos de la red), CGNAT (100.64/10),
 * enlace local (169.254/16 y fe80::/10: metadatos de nube), ULA (fc00::/7), multicast/reservadas, IPv4 escondidas en IPv6 (mapeadas,
 * «compatibles», NAT64, 6to4) — clasificación compartida con el navegador integrado (`isLocalHostname`) — más las IP PROPIAS del equipo
 * (p. ej. su IPv6 global, por la que se alcanza un servicio que escucha en `::`). Cualquier cosa que no sea una IP válida se prohíbe.
 */
export function isForbiddenEgressAddress(ip: string, ownAddresses: readonly string[] = localInterfaceAddresses()): boolean {
  const a = canonicalIp(ip)
  if (!isIP(a)) return true
  if (isLocalHostname(a) || EXTRA_DENIED.has(a)) return true
  return ownAddresses.some((own) => canonicalIp(own) === a)
}

/** Resolución de nombres con todas las direcciones (forma de `dns.lookup(..., { all: true })`). Inyectable en pruebas. */
export type LookupAll = (host: string) => Promise<Array<{ address: string; family: number }>>

const defaultLookup: LookupAll = (host) => lookup(host, { all: true, verbatim: true })

/**
 * Resuelve el nombre UNA sola vez y devuelve la IP a la que conectar, o `null` si no resuelve o ALGUNA de las direcciones devueltas es
 * prohibida (una respuesta mixta pública+interna se rechaza entera). Quien llama conecta a esa IP, nunca al nombre: no hay segunda
 * resolución que un «DNS rebinding» pueda cambiar.
 */
export async function resolveEgressTarget(
  host: string,
  forbidden: (ip: string) => boolean = (ip) => isForbiddenEgressAddress(ip),
  lookupAll: LookupAll = defaultLookup
): Promise<string | null> {
  const bare = host.replace(/^\[|\]$/g, '')
  if (isIP(bare)) return forbidden(bare) ? null : bare
  try {
    const found = await lookupAll(bare)
    if (!Array.isArray(found) || found.length === 0 || found.some((r) => forbidden(r.address))) return null
    return canonicalIp(found[0].address)
  } catch {
    return null
  }
}

/**
 * ¿Se acepta este destino ANTES de resolver? El nombre debe estar en la lista; una IP literal solo si esa IP EXACTA es una entrada de la
 * lista (no por sufijo: `hostAllowed` aceptaría `203.0.113.5` con una entrada heredada `0.113.5`). El puerto, 80 o 443.
 */
export function egressTargetAllowed(host: string, port: number, allowlist: readonly string[]): 'ok' | 'host' | 'port' {
  const bare = host
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
  if (isIP(bare)) {
    if (!allowlist.some((e) => e.toLowerCase().replace(/^\[|\]$/g, '') === bare)) return 'host'
  } else if (!hostAllowed(bare, allowlist)) return 'host'
  return EGRESS_ALLOWED_PORTS.has(port) ? 'ok' : 'port'
}

export interface EgressProxyOptions {
  /** Token (usuario) para `Proxy-Authorization: Basic <base64(token:contraseña)>`; la contraseña se ignora. */
  token: string
  /** Lista blanca de hosts (mutable: se puede ampliar en caliente vía "Permitir siempre/una vez"). */
  allowlist: () => readonly string[]
  onBlocked?: (ev: EgressBlockedEvent) => void
  onLog?: (entry: EgressLogEntry) => void
  /** Solo pruebas: resolución + validación completa. Por defecto `resolveEgressTarget` (DNS real + rechazo de direcciones internas). */
  resolve?: (host: string) => Promise<string | null>
  /** Solo pruebas: el DNS simulado que usa `resolveEgressTarget` (la validación de direcciones sigue siendo la real). */
  lookup?: LookupAll
  /** Solo pruebas: abre la conexión TCP a la IP ya validada (por defecto `net.connect(port, ip)`). */
  dial?: (port: number, ip: string, onConnect: () => void) => Socket
}

export class EgressProxy {
  private server = createNetServer((socket) => this.handleConnection(socket))
  port = 0
  constructor(private opts: EgressProxyOptions) {}

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
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="lazunox-egress"\r\nConnection: close\r\n\r\n'
      )
      return
    }

    if (method === 'CONNECT') {
      this.handleConnect(socket, target ?? '')
      return
    }
    this.handlePlainHttp(socket, method ?? '', target ?? '', headerText, leftover)
  }

  /**
   * El token va en el USUARIO de `Basic`; la contraseña se ignora (el servidor sandboxeado usa `token:x`). El motor empaquetado
   * (Bun 1.3.x) NO se conecta al proxy si la URL trae usuario sin contraseña (`http://token@host`): falla con «ConnectionRefused»
   * sin abrir socket, y con ello los modelos gratuitos (que salen por el proxy de salida) no funcionaban en «Solo en tu carpeta».
   */
  private checkAuth(headers: Map<string, string>): boolean {
    const auth = headers.get('proxy-authorization') ?? ''
    if (!/^Basic /i.test(auth)) return false
    const decoded = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf8')
    const i = decoded.indexOf(':')
    return timingSafeStringEqual(i === -1 ? decoded : decoded.slice(0, i), this.opts.token)
  }

  private splitHostPort(hostport: string, defaultPort: number): { host: string; port: number } {
    const idx = hostport.lastIndexOf(':')
    if (idx === -1) return { host: hostport, port: defaultPort }
    const port = Number(hostport.slice(idx + 1))
    return { host: hostport.slice(0, idx), port: Number.isFinite(port) ? port : defaultPort }
  }

  /** Resolución única + validación de TODAS las direcciones; devuelve la IP a la que conectar o `null`. */
  private resolveTarget(host: string): Promise<string | null> {
    if (this.opts.resolve) return this.opts.resolve(host)
    return resolveEgressTarget(host, undefined, this.opts.lookup)
  }

  private dial(port: number, ip: string, onConnect: () => void): Socket {
    return this.opts.dial ? this.opts.dial(port, ip, onConnect) : netConnect(port, ip, onConnect)
  }

  /** Lista + IP literal + puerto. `false` si se negó (ya respondido al cliente). */
  private admit(socket: Socket, entry: EgressLogEntry): boolean {
    const verdict = egressTargetAllowed(entry.host, entry.port, this.opts.allowlist())
    if (verdict === 'ok') {
      this.opts.onLog?.(entry)
      return true
    }
    entry.allowed = false
    this.opts.onLog?.(entry)
    if (verdict === 'host') {
      this.opts.onBlocked?.(entry)
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nHost not allowed by Lazunox sandbox egress policy\r\n')
    } else {
      // Puerto fuera de 80/443: no se ofrece «Permitir» (permitir el nombre no lo arreglaría); solo queda en el registro.
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nPort not allowed by Lazunox sandbox egress policy\r\n')
    }
    return false
  }

  private handleConnect(socket: Socket, target: string): void {
    const { host, port } = this.splitHostPort(target, 443)
    const entry: EgressLogEntry = { host, port, at: Date.now(), kind: 'connect', allowed: true }
    if (!this.admit(socket, entry)) return
    // Se conecta a la IP YA comprobada (no al nombre): un nombre permitido que resuelva a una dirección local no abre el puerto del motor.
    void this.resolveTarget(host).then((ip) => {
      if (socket.destroyed) return
      if (!ip) {
        this.opts.onLog?.({ ...entry, allowed: false })
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nHost resolves to a local or unresolvable address\r\n')
        return
      }
      const upstream = this.dial(port, ip, () => {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        upstream.pipe(socket)
        socket.pipe(upstream)
      })
      upstream.on('error', () => socket.destroy())
      socket.on('error', () => upstream.destroy())
      socket.on('close', () => upstream.destroy())
      upstream.on('close', () => socket.destroy())
    })
  }

  private handlePlainHttp(socket: Socket, method: string, target: string, headerText: string, leftover: Buffer): void {
    let url: URL
    try {
      url = new URL(target)
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      return
    }
    if (url.protocol !== 'http:') {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      return
    }
    const host = url.hostname
    const port = url.port ? Number(url.port) : 80
    // La cabecera `Host` debe nombrar el MISMO destino que la URL: si no, se pediría otro sitio al servidor de la IP validada.
    const hostHeader = /^host:\s*(.*)$/im.exec(headerText.split('\r\n').slice(1).join('\n'))?.[1]?.trim().toLowerCase()
    if (hostHeader !== undefined && hostHeader !== url.host.toLowerCase() && hostHeader !== `${url.hostname.toLowerCase()}:${port}`) {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\nHost header does not match the request target\r\n')
      return
    }
    const entry: EgressLogEntry = { host, port, at: Date.now(), kind: 'http', allowed: true }
    if (!this.admit(socket, entry)) return
    void this.resolveTarget(host).then((ip) => {
      if (socket.destroyed) return
      if (!ip) {
        this.opts.onLog?.({ ...entry, allowed: false })
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nHost resolves to a local or unresolvable address\r\n')
        return
      }
      this.forwardPlain(socket, method, url, headerText, leftover, port, ip)
    })
  }

  private forwardPlain(socket: Socket, method: string, url: URL, headerText: string, leftover: Buffer, port: number, ip: string): void {
    const upstream = this.dial(port, ip, () => {
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
    socket.on('close', () => upstream.destroy())
    upstream.on('close', () => socket.destroy())
  }
}

export interface CredentialProxyOptions {
  /** Token secreto en el path (`/<token>/...`) que valida que la petición viene del proceso hijo. */
  token: string
  /** Origen real (p.ej. `https://opencode.ai`). */
  targetOrigin: string
  /** Prefijo a anteponer al path reenviado (p.ej. `/inference/go/v1`). */
  targetPathPrefix?: string
  /** Clave REAL a inyectar (nunca se expone al sandbox). */
  key: string
}

/** Cabeceras que pueden llevar una credencial del sandbox (el centinela u otra): se descartan SIEMPRE. */
const CREDENTIAL_HEADERS = new Set(['authorization', 'proxy-authorization', 'x-api-key', 'x-goog-api-key', 'api-key'])
/** Cabeceras de salto/identidad que no se reenvían tal cual. */
const DROPPED_HEADERS = new Set(['host', 'connection'])

/**
 * Cabeceras hacia la API real. Un mismo `baseURL` puede servir a SDKs distintos (openai-compatible → `Authorization: Bearer`,
 * anthropic → `x-api-key`, google → `x-goog-api-key`), así que NO se fija un esquema por proveedor: se descartan TODAS las
 * credenciales del sandbox (el centinela, duplicadas o de otro esquema) y la clave REAL se reinyecta únicamente en la cabecera
 * que el cliente usó (`x-api-key` → `x-api-key`; `x-goog-api-key` o `?key=` → `x-goog-api-key`; `Authorization` o ninguna →
 * `Authorization: Bearer`). `anthropic-version`/`anthropic-beta` las manda el cliente y pasan tal cual.
 */
export function buildUpstreamHeaders(
  incoming: Record<string, string | string[] | undefined>,
  host: string,
  key: string,
  queryHadKey = false
): Record<string, string | string[]> {
  const headers: Record<string, string | string[]> = {}
  let usedApiKey = false
  let usedGoog = queryHadKey
  let usedBearer = false
  let usedApiKeyHdr = false
  for (const [k, v] of Object.entries(incoming)) {
    if (v === undefined) continue
    const lk = k.toLowerCase()
    if (DROPPED_HEADERS.has(lk)) continue
    if (CREDENTIAL_HEADERS.has(lk)) {
      if (lk === 'x-api-key') usedApiKey = true
      else if (lk === 'x-goog-api-key') usedGoog = true
      else if (lk === 'authorization') usedBearer = true
      else if (lk === 'api-key') usedApiKeyHdr = true
      continue
    }
    headers[k] = v
  }
  headers.host = host
  headers['accept-encoding'] = 'identity'
  if (usedApiKey) headers['x-api-key'] = key
  if (usedGoog) headers['x-goog-api-key'] = key
  if (usedApiKeyHdr) headers['api-key'] = key
  if (usedBearer || (!usedApiKey && !usedGoog && !usedApiKeyHdr)) headers.authorization = `Bearer ${key}`
  return headers
}

/** Quita del query los pares de credencial (`key=`, `api_key=`) conservando el resto del texto tal cual (sin re-serializar). */
export function stripQueryCredentials(search: string): { search: string; hadKey: boolean } {
  if (!search || search === '?') return { search, hadKey: false }
  const pairs = search.slice(1).split('&')
  let hadKey = false
  const kept = pairs.filter((pair) => {
    let name = pair.split('=')[0].replace(/\+/g, ' ')
    try {
      name = decodeURIComponent(name)
    } catch {
      /* nombre no decodificable: se compara tal cual */
    }
    if (!/^(key|api[_-]?key)$/i.test(name.trim())) return true
    if (name.trim().toLowerCase() === 'key') hadKey = true
    return false
  })
  if (kept.length === pairs.length) return { search, hadKey }
  const out = kept.join('&')
  return { search: out ? `?${out}` : '', hadKey }
}

/** Métodos que se reenvían a la API real. */
const ALLOWED_METHODS = new Set(['GET', 'POST', 'HEAD', 'OPTIONS'])
/** Segmentos de ruta de administración/almacenamiento que un sandbox no necesita (denegar, no lista blanca). */
const DENIED_SEGMENTS = new Set([
  'files',
  'batches',
  'fine_tuning',
  'fine-tunes',
  'fine_tunes',
  'keys',
  'api-keys',
  'api_keys',
  'billing',
  'organization',
  'organizations',
  'admin',
  'usage-admin',
  'projects',
  'members',
  'users',
  'invites',
  'tokens',
  'uploads',
  'vector_stores',
  'assistants',
  'threads'
])
/** true si algún segmento del path (sin importar mayúsculas) está denegado. */
export function hasDeniedSegment(path: string): boolean {
  let decoded = path
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return true
  }
  return decoded.split('/').some((seg) => DENIED_SEGMENTS.has(seg.toLowerCase()))
}
/** Cabeceras de respuesta que nunca se devuelven al sandbox. */
const DROPPED_RESPONSE_HEADERS = new Set(['set-cookie', 'www-authenticate', 'proxy-authenticate'])
const MAX_REDACT_BODY = 64 * 1024
const REDACTED = '[clave oculta]'

/** Cabeceras de respuesta filtradas; `null` si el redirect sale del origen del destino. */
export function filterResponseHeaders(
  headers: Record<string, string | string[] | undefined>,
  key: string,
  targetUrl: URL
): Record<string, string | string[]> | null {
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue
    const lk = k.toLowerCase()
    if (DROPPED_RESPONSE_HEADERS.has(lk)) continue
    const vals = Array.isArray(v) ? v : [v]
    if (vals.some((x) => x.includes(key))) continue
    if (lk === 'location') {
      let ok = false
      try {
        ok = new URL(vals[0] ?? '', targetUrl).origin === targetUrl.origin
      } catch {
        ok = false
      }
      if (!ok) return null
    }
    out[k] = v
  }
  return out
}

/** Proxy inverso de un único destino que inyecta la clave real del proveedor. */
export class CredentialProxy {
  private server = createHttpServer((req, res) => this.handle(req, res))
  port = 0

  constructor(private opts: CredentialProxyOptions) {
    // Falla cerrado al construir (no dentro del manejador de peticiones): clave vacía.
    if (typeof opts.key !== 'string' || !opts.key) throw new Error('credential-proxy: clave vacía')
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

  /** `http://127.0.0.1:<port>/<token>` — usar como `baseURL` del proveedor. */
  baseUrl(): string {
    return `http://127.0.0.1:${this.port}/${this.opts.token}`
  }

  /** Respuesta de la API al sandbox: sin cookies/desafíos/redirects externos ni la clave real (cabeceras; cuerpo pequeño no-SSE). */
  private relay(upstreamRes: IncomingMessage, res: ServerResponse, target: URL): void {
    const status = upstreamRes.statusCode ?? 502
    const headers = filterResponseHeaders(upstreamRes.headers, this.opts.key, target)
    if (!headers) {
      upstreamRes.resume()
      res.writeHead(502, { 'content-type': 'text/plain' }).end('credential-proxy: redirect fuera del destino bloqueado')
      return
    }
    const type = String(upstreamRes.headers['content-type'] ?? '').toLowerCase()
    const redactable = /^(text\/|application\/(json|[a-z.+-]*\+json|xml))/.test(type) && !type.includes('event-stream')
    if (!redactable) {
      res.writeHead(status, headers)
      upstreamRes.pipe(res)
      return
    }
    // Cuerpo texto/JSON: se acumula hasta 64 KB para ocultar la clave; si crece más, pasa a streaming sin tocar el resto.
    const chunks: Buffer[] = []
    let size = 0
    let streaming = false
    upstreamRes.on('data', (c: Buffer) => {
      if (streaming) {
        res.write(c)
        return
      }
      chunks.push(c)
      size += c.length
      if (size > MAX_REDACT_BODY) {
        streaming = true
        res.writeHead(status, headers)
        res.write(Buffer.concat(chunks))
        chunks.length = 0
      }
    })
    upstreamRes.on('end', () => {
      if (streaming) {
        res.end()
        return
      }
      const body = Buffer.concat(chunks).toString('utf8').split(this.opts.key).join(REDACTED)
      const out = { ...headers }
      for (const k of Object.keys(out)) if (['content-length', 'transfer-encoding'].includes(k.toLowerCase())) delete out[k]
      out['content-length'] = String(Buffer.byteLength(body))
      res.writeHead(status, out)
      res.end(body)
    })
    upstreamRes.on('error', () => res.destroy())
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/'
    const prefix = `/${this.opts.token}`
    if (!url.startsWith(prefix)) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden')
      return
    }
    if (!ALLOWED_METHODS.has((req.method ?? '').toUpperCase())) {
      res.writeHead(405, { 'content-type': 'text/plain', allow: 'GET, POST, HEAD, OPTIONS' }).end('method not allowed')
      return
    }
    const rest = safeUpstreamRest(url.slice(prefix.length))
    if (rest === null) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad path')
      return
    }
    if (hasDeniedSegment(rest.split('?')[0])) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('path not allowed')
      return
    }
    const apiPrefix = this.opts.targetPathPrefix ?? ''
    const target = new URL(`${this.opts.targetOrigin}${apiPrefix}${rest}`)
    // Defensa en profundidad: tras normalizar, el destino sigue en el mismo origen y bajo el prefijo.
    if (
      target.origin !== new URL(this.opts.targetOrigin).origin ||
      !(target.pathname + '/').startsWith(`${apiPrefix.replace(/\/+$/, '')}/`)
    ) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad path')
      return
    }
    const isHttps = target.protocol === 'https:'
    const q = stripQueryCredentials(target.search)
    const headers = buildUpstreamHeaders(req.headers, target.host, this.opts.key, q.hadKey)

    const fn = isHttps ? httpsRequest : httpRequest
    const upstream = fn(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${q.search}`,
        method: req.method,
        headers
      },
      (upstreamRes) => this.relay(upstreamRes, res, target)
    )
    upstream.on('error', (err) => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' })
      res.end(`credential-proxy upstream error: ${err.message}`)
    })
    req.pipe(upstream)
  }
}

/**
 * Resto de la URL tras el token, listo para añadir al prefijo de la API; `null` si intenta salir del prefijo
 * (F8-B69): `..`/`.` (también `%2e`), barras invertidas, `//`, `%2f`/`%5c` codificados, doble codificación
 * (`%25`), bytes de control o un resto que no empieza por `/` o `?`.
 */
export function safeUpstreamRest(raw: string): string | null {
  const rest = raw === '' ? '/' : raw
  if (rest[0] !== '/' && rest[0] !== '?') return null
  const q = rest.indexOf('?')
  const path = q === -1 ? rest : rest.slice(0, q)
  const query = q === -1 ? '' : rest.slice(q)
  if (rest.includes('#')) return null
  if (/[\\\u0000-\u001f\u007f]/.test(rest)) return null
  if (path.includes(';')) return null
  if (/%25/i.test(path) || /%5c/i.test(path) || /%2f/i.test(path)) return null
  let decoded: string
  try {
    decoded = decodeURIComponent(path)
  } catch {
    return null
  }
  if (/[\\\u0000-\u001f\u007f]/.test(decoded) || decoded.includes('//')) return null
  for (const seg of decoded.split('/')) if (seg === '.' || seg === '..') return null
  if (path.includes('//')) return null
  return (path === '' ? '/' : path) + query
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString('base64url')
}
