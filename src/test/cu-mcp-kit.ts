/**
 * Utilidades de prueba para el MCP de Control del PC (`src/main/computer/mcp-server.ts`): empaquetan el MCP como lo hace
 * `electron-vite` (una entrada autónoma, solo builtins de Node), lo lanzan como proceso suelto con el helper FALSO
 * (`e2e/fake-cu-helper/fake.mjs`) y un canal lateral simulado (kill-switch, concesiones, plan), y registran todo lo que el MCP
 * le pide al helper y a main. No toca la pantalla ni el ratón del equipo: no existe ningún helper real en el circuito.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateSync } from 'node:zlib'
import { buildSync } from 'esbuild'

const ROOT = resolve(__dirname, '..', '..')
export const FAKE_HELPER = join(ROOT, 'e2e', 'fake-cu-helper', 'fake.mjs')

/** Empaqueta el MCP (con lo que importe de `src/main/computer`) a un `.cjs` autónomo y devuelve su ruta. */
export function bundleMcp(dir: string): string {
  const outfile = join(dir, 'computer-mcp.cjs')
  buildSync({
    entryPoints: [join(ROOT, 'src', 'main', 'computer', 'mcp-server.ts')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile,
    logLevel: 'silent'
  })
  return outfile
}

function crc32(buf: Buffer): number {
  let r = 0xffffffff
  for (const b of buf) {
    r ^= b
    for (let k = 0; k < 8; k++) r = r & 1 ? 0xedb88320 ^ (r >>> 1) : r >>> 1
  }
  return (r ^ 0xffffffff) >>> 0
}

/** PNG RGB de color liso (válido para `sips`); pesa unos pocos KB aunque sea grande. */
export function makePng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const stride = width * 3 + 1
  const raw = Buffer.alloc(stride * height, 0x80)
  for (let y = 0; y < height; y++) raw[y * stride] = 0
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// ───────────────────────────── canal lateral simulado ─────────────────────────────

export interface SideRequest {
  method: string
  path: string
  query: Record<string, string>
  body?: unknown
}

export interface SideChannelOptions {
  /** `stopped` del kill-switch (puede cambiar durante la prueba). */
  stopped?: () => boolean
  /** Nivel por clave de app (`bundleId`); por defecto `full`. `null` = sin concesión. */
  tier?: (key: string) => 'view' | 'click' | 'full' | null
  /** Plan aprobado (por defecto sí). */
  planApproved?: boolean
  /** `{ mode, foreground }` de `/control-mode` (por defecto `full`). */
  controlMode?: { mode: 'background' | 'full'; foreground: boolean }
  /** Respuesta de `/consent` (solo Windows). Por defecto `{ consent: true, version: 1 }`; `null` = el endpoint falla (500). */
  consent?: (() => { consent: boolean; version?: number } | null) | null
  /** Respuesta de `/request-access`. */
  requestAccess?: (body: unknown) => unknown
  /** Responde 500 a todo (main caído: el MCP debe fallar cerrado). */
  down?: boolean
}

export interface SideChannel {
  url: string
  requests: SideRequest[]
  /** Eventos de acción (`POST /`) sin la marca de tiempo. */
  actions: () => Array<Record<string, unknown>>
  close: () => Promise<void>
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return text ? JSON.parse(text) : undefined
  } catch {
    return undefined
  }
}

export async function startSideChannel(opts: SideChannelOptions = {}): Promise<SideChannel> {
  const requests: SideRequest[] = []
  const server: Server = createServer((req, res) => {
    void (async () => {
      const u = new URL(req.url ?? '/', 'http://127.0.0.1')
      const body = req.method === 'POST' ? await readJson(req) : undefined
      requests.push({ method: req.method ?? 'GET', path: u.pathname, query: Object.fromEntries(u.searchParams), body })
      const json = (status: number, v: unknown): void => {
        res.statusCode = status
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(v))
      }
      if (opts.down) return json(500, { error: 'down' })
      switch (u.pathname) {
        case '/state':
          return json(200, { stopped: opts.stopped?.() ?? false })
        case '/tier':
          return json(200, { tier: (opts.tier ?? (() => 'full'))(u.searchParams.get('bundleId') ?? '') })
        case '/plan-status':
          return json(200, { approved: opts.planApproved ?? true })
        case '/control-mode':
          return json(200, opts.controlMode ?? { mode: 'full', foreground: true })
        case '/consent': {
          const c = opts.consent === undefined ? { consent: true, version: 1 } : opts.consent === null ? null : opts.consent()
          return c ? json(200, c) : json(500, { error: 'sin consentimiento legible' })
        }
        case '/request-access':
          return json(
            200,
            opts.requestAccess?.(body) ?? {
              decisions: Object.fromEntries(
                ((body as { apps?: Array<{ bundleId: string }> })?.apps ?? []).map((a) => [a.bundleId, 'full'])
              ),
              cancelled: false,
              planApproved: true
            }
          )
        case '/teach-step':
          return json(200, { action: 'next' })
        default:
          res.statusCode = 204
          res.end()
      }
    })()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    actions: () =>
      requests
        .filter((r) => r.method === 'POST' && r.path === '/')
        .map((r) => {
          const { at: _at, ...rest } = (r.body ?? {}) as Record<string, unknown>
          void _at
          return rest
        }),
    close: () => new Promise<void>((r) => server.close(() => r()))
  }
}

// ───────────────────────────── el MCP como proceso ─────────────────────────────

export interface McpOptions {
  bundle: string
  helper: string
  /** Variables extra (pisan a las de por defecto). */
  env?: Record<string, string>
  /** Guion del helper falso (se escribe en un JSON temporal). */
  script?: Record<string, unknown>
  events?: SideChannel
  /** `darwin` (por defecto) o `win32`: el helper falso emula esa plataforma. */
  platform?: 'darwin' | 'win32'
  /** Imagen que copian los comandos de captura del helper falso. */
  image?: Buffer
  /** Carpeta de trabajo (capturas, registro, guion). */
  dir: string
}

export interface ToolReply {
  content: Array<{ type: string; text?: string; data?: string }>
  isError?: boolean
}

export interface McpProc {
  child: ChildProcess
  port: number
  shotDir: string
  logFile: string
  stderr: () => string
  rpc: (method: string, params?: Record<string, unknown>) => Promise<{ result?: unknown; error?: { code: number; message: string } }>
  call: (
    name: string,
    args?: Record<string, unknown>
  ) => Promise<{ content: Array<{ type: string; text?: string; data?: string }>; isError?: boolean }>
  /** Llamadas al helper falso (sin los eventos de parada). */
  calls: () => Array<{ cmd: string; args: string[]; flags: string[] }>
  /** Todo el registro, con eventos `stop`/`sigterm`. */
  log: () => Array<Record<string, unknown>>
  stop: () => Promise<void>
}

export async function startMcp(o: McpOptions): Promise<McpProc> {
  mkdirSync(o.dir, { recursive: true })
  const logFile = join(o.dir, 'calls.jsonl')
  const shotDir = join(o.dir, 'shots')
  const scriptFile = join(o.dir, 'script.json')
  writeFileSync(scriptFile, JSON.stringify({ responses: {}, ...(o.script ?? {}) }))
  const imageFile = join(o.dir, 'fake-image')
  if (o.image) writeFileSync(imageFile, o.image)
  const token = 'tok-' + 'x'.repeat(40)
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: o.dir,
    TMPDIR: o.dir,
    COMPUTER_MCP_TOKEN: token,
    COMPUTER_MCP_PORT: '0',
    CU_HELPER: o.helper,
    COMPUTER_SHOT_DIR: shotDir,
    FAKE_CU_LOG: logFile,
    FAKE_CU_SCRIPT: scriptFile,
    FAKE_CU_PLATFORM: o.platform ?? 'darwin',
    ...(o.image ? { FAKE_CU_IMAGE: imageFile } : {}),
    ...(o.events ? { COMPUTER_EVENTS_URL: o.events.url } : {}),
    ...o.env
  }
  const child = spawn(process.execPath, [o.bundle], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let err = ''
  child.stderr?.on('data', (d: Buffer) => (err += d.toString()))
  const port = await new Promise<number>((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`el MCP no arrancó: ${err}`)), 10_000)
    let buf = ''
    child.stdout?.on('data', (d: Buffer) => {
      buf += d.toString()
      const m = /\{"type":"ready","port":(\d+)\}/.exec(buf)
      if (m) {
        clearTimeout(timer)
        resolveReady(Number(m[1]))
      }
    })
    child.once('exit', (c) => {
      clearTimeout(timer)
      reject(new Error(`el MCP terminó al arrancar (${c}): ${err}`))
    })
  })
  let id = 0
  const rpc: McpProc['rpc'] = async (method, params) => {
    const r = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params })
    })
    return (await r.json()) as never
  }
  const readLog = (): Array<Record<string, unknown>> =>
    existsSync(logFile)
      ? readFileSync(logFile, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      : []
  return {
    child,
    port,
    shotDir,
    logFile,
    stderr: () => err,
    rpc,
    call: async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result as ToolReply,
    calls: () => readLog().filter((e) => typeof e.cmd === 'string' && !e.event) as never,
    log: readLog,
    stop: async () => {
      if (child.exitCode !== null) return
      child.kill('SIGTERM')
      await new Promise<void>((r) => {
        const t = setTimeout(() => (child.kill('SIGKILL'), r()), 2000)
        child.once('exit', () => (clearTimeout(t), r()))
      })
    }
  }
}

export function tmpWork(prefix: string): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

/** Texto de la primera parte de texto de un resultado de herramienta. */
export function textOf(r: { content: Array<{ type: string; text?: string }> }): string {
  return r.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n')
}
