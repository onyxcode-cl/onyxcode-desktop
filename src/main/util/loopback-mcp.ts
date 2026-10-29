/**
 * Transporte común de los servidores MCP PROPIOS de la app que viven en el proceso principal y se ofrecen a las Tareas por una ruta del proxy MCP
 * (`documentos`, `equipo`): HTTP JSON-RPC en 127.0.0.1, un Bearer de 32 bytes POR ATADURA (carpeta de la tarea), cualquier cabecera `Origin` → 403,
 * `Host` exacto (contra DNS rebinding), cuerpo ≤ 1 MiB, solo POST. Calcado de `embedded-browser/mcp-server.ts`. No importa `electron`.
 * Quien lo extiende solo aporta su nombre, sus instrucciones, la lista de herramientas y `callTool`.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { getFreePort } from './net'

export const LOOPBACK_HOST = '127.0.0.1'
export const MAX_BODY = 1024 * 1024
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']

interface RpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: Record<string, unknown>
}
type RpcResponse =
  | { jsonrpc: '2.0'; id: number | string | null; result: unknown }
  | { jsonrpc: '2.0'; id: number | string | null; error: { code: number; message: string } }

export type McpToolResult = {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>
  isError?: boolean
}

export abstract class LoopbackMcpServer<B extends { folder: string }> {
  private server: ReturnType<typeof createServer> | null = null
  private port = 0
  private starting: Promise<number> | null = null
  private readonly clients = new Map<string, B>()
  private readonly issued: string[] = []

  /** `label` va en los mensajes de registro (`[documentos-mcp]`). */
  protected constructor(protected readonly label: string) {}

  protected abstract readonly serverName: string
  protected abstract readonly instructions: string
  protected abstract listTools(): readonly unknown[]
  protected abstract callTool(binding: B, name: string, args: Record<string, unknown>): Promise<McpToolResult>
  /** Tiempo máximo (ms) que OpenCode espera una llamada a este servidor. */
  protected configTimeoutMs(): number {
    return 15_000
  }
  /** Se llama al sustituir o revocar un token (un servidor que termina): por si hay que limpiar lo de esa atadura. */
  protected onBindingGone(_binding: B): void {}

  protected log(...a: unknown[]): void {
    console.log(`[${this.label}]`, ...a.map(String))
  }

  private async ensureServer(): Promise<number> {
    if (this.server && this.port) return this.port
    this.starting ??= this.launch().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private async launch(): Promise<number> {
    const port = await getFreePort(LOOPBACK_HOST)
    const server = createServer((req, res) => {
      try {
        this.handleHttp(req, res, port)
      } catch (err) {
        this.log('http', err)
        if (!res.headersSent) this.reply(res, 500)
      }
    })
    server.requestTimeout = 0
    server.headersTimeout = 30_000
    server.keepAliveTimeout = 60_000
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, LOOPBACK_HOST, () => resolve())
    })
    this.server = server
    this.port = port
    this.log(`listo en ${LOOPBACK_HOST}:${port}`)
    return port
  }

  /** Registra un token nuevo (32 bytes) para esta atadura; el anterior de la misma carpeta deja de valer. */
  async clientFor(binding: B): Promise<{ token: string; port: number }> {
    const port = await this.ensureServer()
    for (const [old, b] of this.clients) {
      if (b.folder === binding.folder) {
        this.clients.delete(old)
        this.onBindingGone(b)
      }
    }
    const token = randomBytes(32).toString('base64url')
    this.clients.set(token, binding)
    this.issued.push(token)
    if (this.issued.length > 256) this.issued.splice(0, this.issued.length - 256)
    return { token, port }
  }

  revokeToken(token: string): boolean {
    const b = this.clients.get(token)
    const had = this.clients.delete(token)
    if (b) this.onBindingGone(b)
    return had
  }

  /** Tokens emitidos: el redactor de Diagnóstico los trata como secretos exactos. */
  knownTokens(): string[] {
    return [...this.issued]
  }

  /** Bloque `mcp.<nombre>` (config `remote` de OpenCode), o null si no pudo arrancar (no fatal). */
  async configFor(binding: B): Promise<Record<string, unknown> | null> {
    try {
      const { token, port } = await this.clientFor(binding)
      return {
        type: 'remote',
        url: `http://${LOOPBACK_HOST}:${port}/mcp`,
        headers: { Authorization: `Bearer ${token}` },
        oauth: false,
        enabled: true,
        timeout: this.configTimeoutMs()
      }
    } catch (err) {
      console.error(`[${this.label}] no se pudo arrancar:`, err)
      return null
    }
  }

  currentPort(): number | null {
    return this.port || null
  }

  async stop(): Promise<void> {
    const s = this.server
    this.server = null
    this.port = 0
    for (const b of this.clients.values()) this.onBindingGone(b)
    this.clients.clear()
    if (s) await new Promise<void>((resolve) => s.close(() => resolve()))
  }

  private lookupClient(token: string | undefined): B | null {
    if (!token) return null
    const tokenBuf = Buffer.from(token)
    for (const [t, binding] of this.clients) {
      const tBuf = Buffer.from(t)
      if (tBuf.length === tokenBuf.length && timingSafeEqual(tBuf, tokenBuf)) return binding
    }
    return null
  }

  private reply(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}): void {
    res.statusCode = status
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
    if (body === undefined) {
      res.end()
      return
    }
    res.setHeader('content-type', 'application/json')
    res.setHeader('cache-control', 'no-store')
    res.end(JSON.stringify(body))
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse, port: number): void {
    const url = req.url ?? ''
    if (url !== '/mcp' && !url.startsWith('/mcp?')) return this.reply(res, 404)
    if (req.headers.origin) return this.reply(res, 403, { error: 'origin not allowed' })
    const host = req.headers.host ?? ''
    if (host !== `${LOOPBACK_HOST}:${port}` && host !== `localhost:${port}`) return this.reply(res, 403, { error: 'bad host' })
    const auth = req.headers.authorization
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
    const binding = this.lookupClient(token)
    if (!binding) return this.reply(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' })
    if (req.method !== 'POST') return this.reply(res, 405, undefined, { allow: 'POST' })

    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        this.reply(res, 413)
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      let parsed: unknown
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return this.reply(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      }
      const batch = Array.isArray(parsed)
      const list: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
      const msgs = list.filter((m): m is RpcRequest => !!m && typeof m === 'object' && typeof (m as RpcRequest).method === 'string')
      void Promise.all(msgs.map((m) => this.dispatch(m, binding))).then((out) => {
        const responses = out.filter((r): r is RpcResponse => r !== null)
        if (!responses.length) return this.reply(res, 202)
        this.reply(res, 200, batch ? responses : responses[0])
      })
    })
  }

  private async dispatch(req: RpcRequest, binding: B): Promise<RpcResponse | null> {
    const id = req.id ?? null
    const isNotification = req.id === undefined || req.id === null
    const ok = (result: unknown): RpcResponse => ({ jsonrpc: '2.0', id, result })
    const error = (code: number, message: string): RpcResponse | null =>
      isNotification ? null : { jsonrpc: '2.0', id, error: { code, message } }
    try {
      switch (req.method) {
        case 'initialize': {
          const asked = String(req.params?.protocolVersion ?? '')
          return ok({
            protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: this.serverName, version: '0.1.0' },
            instructions: this.instructions
          })
        }
        case 'ping':
          return ok({})
        case 'tools/list':
          return ok({ tools: this.listTools() })
        case 'tools/call': {
          const name = String(req.params?.name ?? '')
          const rawArgs = req.params?.arguments
          const args = rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs) ? (rawArgs as Record<string, unknown>) : {}
          return ok(await this.callTool(binding, name, args))
        }
        case 'resources/list':
          return ok({ resources: [] })
        case 'prompts/list':
          return ok({ prompts: [] })
        default:
          return isNotification ? null : error(-32601, `Método no soportado: ${req.method}`)
      }
    } catch (err) {
      this.log('error', err)
      return error(-32603, 'Error interno.')
    }
  }
}
