/**
 * Pasarela del navegador propio de Cowork (Lote C, B.10). Entrada `browser-mcp`
 * (`out/main/browser-mcp.js`), ejecutada directamente por `node` o por el binario de `opencode`
 * con `BUN_BE_BUN=1` (el `.app` empaquetado no tiene Node: fuse `RunAsNode` desactivado) — NUNCA
 * por Electron. Solo usa builtins de Node (`node:child_process`, `node:http`, `node:process`) más
 * el módulo puro hermano `./sites`: nada de `electron`, del SDK de MCP ni de npm.
 *
 * Es un proxy JSON-RPC por stdio (líneas NDJSON, como espera el cliente MCP de OpenCode) delante
 * de un `chrome-devtools-mcp` real que lanza como hijo:
 *  - `tools/list`: quita las herramientas de `BLOCKED` (`upload_file`) de la respuesta real.
 *  - `tools/call`: solo reenvía nombres que la última `tools/list` real haya devuelto (y no
 *    bloqueado); cualquier otro nombre es un error, incluso antes de la primera `tools/list`
 *    (nada se permite por defecto).
 *  - Antes de `navigate_page` (tipo `url`) y `new_page`: valida el esquema (`checkUrl`) y pide
 *    aprobación por sitio al canal lateral de `browser/service.ts` (`LAPIS_BROWSER_URL`). Si se
 *    niega, ni se reenvía la llamada al hijo.
 *  - Después de `click`, `fill`, `fill_form`, `press_key`, `evaluate_script`, `type_text` (añadido
 *    por prudencia: también puede enviar un formulario) y cualquier `navigate_page`: pide
 *    `list_pages` al hijo y repite la comprobación sobre TODAS las páginas abiertas (un `click` o
 *    un script pueden abrir pestañas nuevas o redirigir). Toda página en un host no permitido se
 *    manda a `about:blank` y la llamada original responde con error.
 *  - Si `list_pages` falla o su formato no se puede interpretar: error (nunca se asume que está
 *    todo bien — cierre en caso de duda).
 *  - Al cerrarse `stdin` (o llegar SIGTERM), mata al hijo y con ello Chrome.
 */
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import process from 'node:process'
import { checkUrl, hostOf } from './sites'

const CDM_RUNTIME = process.env.CDM_RUNTIME
const CDM_BIN = process.env.CDM_BIN
const CHROME_PATH = process.env.CHROME_PATH
const PROFILE = process.env.LAPIS_BROWSER_PROFILE
const SITE_CHECK_URL = process.env.LAPIS_BROWSER_URL
const FOLDER = process.env.LAPIS_BROWSER_FOLDER ?? ''
// Solo para las pruebas de este paquete (B.10): nunca lo fija `service.ts` en producción.
const HEADLESS = process.env.LAPIS_BROWSER_HEADLESS === '1'

if (!CDM_RUNTIME || !CDM_BIN || !CHROME_PATH || !PROFILE) {
  console.error('[browser-mcp] faltan variables de entorno: CDM_RUNTIME, CDM_BIN, CHROME_PATH, LAPIS_BROWSER_PROFILE.')
  process.exit(1)
}

/** Herramientas que nunca se exponen, aunque el `chrome-devtools-mcp` real las devuelva. */
const BLOCKED = new Set<string>(['upload_file'])
/** Antes de reenviarlas hay que comprobar la URL de destino (van a una página nueva). */
const PRE_CHECK_TOOLS = new Set<string>(['navigate_page', 'new_page'])
/** Después de reenviarlas (con éxito) se revisan TODAS las páginas abiertas. */
const POST_CHECK_TOOLS = new Set<string>(['click', 'fill', 'fill_form', 'press_key', 'evaluate_script', 'navigate_page', 'type_text'])

type JsonRpcId = string | number | null
interface RpcMessage {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
  result?: unknown
  error?: unknown
}

function isRpcMessage(v: unknown): v is RpcMessage {
  return !!v && typeof v === 'object'
}

/** Lee un stream NDJSON (una llamada por línea) y entrega cada mensaje ya parseado. */
function lineReader(stream: NodeJS.ReadableStream, onMessage: (msg: RpcMessage) => void): void {
  let buf = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    buf += chunk
    let idx = buf.indexOf('\n')
    while (idx >= 0) {
      const line = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 1)
      if (line) {
        try {
          const parsed: unknown = JSON.parse(line)
          if (isRpcMessage(parsed)) onMessage(parsed)
        } catch (err) {
          console.error('[browser-mcp] línea JSON inválida:', err)
        }
      }
      idx = buf.indexOf('\n')
    }
  })
}

function writeMessage(stream: NodeJS.WritableStream, msg: RpcMessage): void {
  stream.write(`${JSON.stringify(msg)}\n`)
}

// ────────────────────────── Hijo: el chrome-devtools-mcp real ──────────────────────────

const child = spawn(
  CDM_RUNTIME,
  [
    CDM_BIN,
    '--userDataDir',
    PROFILE,
    '--executablePath',
    CHROME_PATH,
    '--no-usage-statistics',
    '--categoryPerformance=false',
    '--categoryMemory=false',
    '--categoryEmulation=false',
    '--viewport',
    '1280x800',
    ...(HEADLESS ? ['--headless'] : [])
  ],
  {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      // Sin esto, chrome-devtools-mcp escribe ~/.cache/chrome-devtools-mcp/latest.json y lanza un
      // proceso aparte que consulta el registro de npm en cada arranque, aunque se pase
      // --no-usage-statistics (esa variable es otra: telemetría de uso, no la comprobación de
      // versión). Verificado en este paquete: sin esta variable SÍ escribe en el `~/.cache` del
      // usuario, algo que el encargo prohíbe explícitamente.
      CHROME_DEVTOOLS_MCP_NO_UPDATE_CHECKS: '1'
    }
  }
)

child.stderr.setEncoding('utf8')
child.stderr.on('data', (chunk: string) => process.stderr.write(chunk))

child.on('exit', (code) => {
  process.exit(code ?? 0)
})
child.on('error', (err) => {
  console.error('[browser-mcp] no se pudo lanzar chrome-devtools-mcp:', err)
  process.exit(1)
})

let internalCounter = 0
const pendingInternal = new Map<string, { resolve: (m: RpcMessage) => void }>()

function nextInternalId(): string {
  internalCounter += 1
  return `gw:${internalCounter}`
}

/** Llama a una herramienta/método del hijo y espera su respuesta (correlación por id propio). */
function callChild(method: string, params?: unknown): Promise<RpcMessage> {
  return new Promise((resolve) => {
    const id = nextInternalId()
    pendingInternal.set(id, { resolve })
    writeMessage(child.stdin, { jsonrpc: '2.0', id, method, params })
  })
}

lineReader(child.stdout, (msg) => {
  if (typeof msg.id === 'string' && pendingInternal.has(msg.id)) {
    const pending = pendingInternal.get(msg.id)
    pendingInternal.delete(msg.id)
    pending?.resolve(msg)
    return
  }
  if (msg.id === undefined) {
    // Notificación del hijo sin correlación (p. ej. `notifications/tools/list_changed`): se reenvía.
    writeMessage(process.stdout, msg)
  }
  // Una respuesta con un id que no reconocemos no debería ocurrir; se ignora en vez de reenviarla
  // (podría confundirse con la respuesta a otra llamada del padre).
})

// ────────────────────────── Canal lateral: aprobación por sitio ──────────────────────────

function siteCheck(url: string): Promise<{ allow: boolean; reason?: string }> {
  return new Promise((resolve) => {
    if (!SITE_CHECK_URL) {
      resolve({ allow: false, reason: 'El canal de aprobación de sitios no está disponible.' })
      return
    }
    let target: URL
    try {
      target = new URL(SITE_CHECK_URL)
    } catch {
      resolve({ allow: false, reason: 'El canal de aprobación de sitios es inválido.' })
      return
    }
    const body = JSON.stringify({ url, folder: FOLDER })
    const req = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
        // El usuario puede tardar en responder al diálogo nativo de aprobación.
        timeout: 120_000
      },
      (res) => {
        let data = ''
        res.setEncoding('utf8')
        res.on('data', (c: string) => (data += c))
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { allow?: unknown; reason?: unknown }
            resolve({ allow: parsed.allow === true, reason: typeof parsed.reason === 'string' ? parsed.reason : undefined })
          } catch {
            resolve({ allow: false, reason: 'Respuesta inválida del canal de aprobación de sitios.' })
          }
        })
      }
    )
    req.on('error', () => resolve({ allow: false, reason: 'No se pudo consultar el canal de aprobación de sitios.' }))
    req.on('timeout', () => {
      req.destroy()
      resolve({ allow: false, reason: 'Se agotó el tiempo de espera al pedir aprobación del sitio.' })
    })
    req.end(body)
  })
}

/** `null` si la URL se puede navegar; si no, el texto de error a devolver por la herramienta. */
async function forbiddenReason(url: string): Promise<string | null> {
  if (!checkUrl(url)) return `El usuario no permitió abrir ${url}.`
  if (url === 'about:blank') return null
  const decision = await siteCheck(url)
  if (decision.allow) return null
  return `El usuario no permitió abrir ${hostOf(url) ?? url}.`
}

// ────────────────────────── Lista de páginas: parseo defensivo ──────────────────────────

interface PageInfo {
  pageId: number
  url: string
}

function extractText(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content) || content.length === 0) return null
  const first = content[0] as unknown
  if (!first || typeof first !== 'object') return null
  const text = (first as { text?: unknown }).text
  return typeof text === 'string' ? text : null
}

/** `null` = formato no reconocido (cierre en caso de duda: no se puede verificar). */
function parsePages(text: string): PageInfo[] | null {
  const pages: PageInfo[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = /^(\d+):\s*(.*)$/.exec(line)
    if (!m) return null
    const pageId = Number(m[1])
    const rest = m[2]
    const urlMatch = /\(([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^)]*)\)/.exec(rest)
    if (urlMatch) {
      pages.push({ pageId, url: urlMatch[1] })
    } else if (/^about:blank\b/.test(rest)) {
      pages.push({ pageId, url: 'about:blank' })
    } else {
      return null
    }
  }
  return pages
}

/** `null` si todas las páginas abiertas están en un host permitido; si no, el texto de error. */
async function verifyPages(): Promise<string | null> {
  const resp = await callChild('tools/call', { name: 'list_pages', arguments: {} })
  if (resp.error) return 'No se pudieron revisar las páginas abiertas: se corta por seguridad.'
  const text = extractText(resp.result)
  const pages = text === null ? null : parsePages(text)
  if (pages === null) return 'No se pudieron revisar las páginas abiertas: se corta por seguridad.'
  const blockedHosts: string[] = []
  for (const page of pages) {
    if (page.url === 'about:blank') continue
    const reason = await forbiddenReason(page.url)
    if (reason) {
      blockedHosts.push(hostOf(page.url) ?? page.url)
      await callChild('tools/call', {
        name: 'navigate_page',
        arguments: { pageId: page.pageId, type: 'url', url: 'about:blank' }
      })
    }
  }
  if (blockedHosts.length === 0) return null
  return `El usuario no permitió abrir ${blockedHosts.join(', ')}.`
}

// ────────────────────────── Padre (OpenCode): dispatcher ──────────────────────────

let allowedTools = new Set<string>()

function reply(id: JsonRpcId, result?: unknown, error?: unknown): void {
  if (id === undefined || id === null) return
  if (error !== undefined) writeMessage(process.stdout, { jsonrpc: '2.0', id, error })
  else writeMessage(process.stdout, { jsonrpc: '2.0', id, result })
}

function toolError(text: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text }], isError: true }
}

interface ToolInfo {
  name: string
  [key: string]: unknown
}

function extractTools(result: unknown): ToolInfo[] {
  if (!result || typeof result !== 'object') return []
  const arr = (result as { tools?: unknown }).tools
  if (!Array.isArray(arr)) return []
  return arr.filter((t): t is ToolInfo => !!t && typeof t === 'object' && typeof (t as ToolInfo).name === 'string')
}

async function handleToolCall(id: JsonRpcId, name: string, args: unknown, originalParams: unknown): Promise<void> {
  const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {}
  if (PRE_CHECK_TOOLS.has(name)) {
    const url =
      name === 'new_page'
        ? typeof a.url === 'string'
          ? a.url
          : ''
        : a.type === 'url' && typeof a.url === 'string'
          ? a.url
          : ''
    if (url) {
      const err = await forbiddenReason(url)
      if (err) {
        reply(id, toolError(err))
        return
      }
    }
  }
  const resp = await callChild('tools/call', originalParams)
  if (resp.error) {
    reply(id, undefined, resp.error)
    return
  }
  if (POST_CHECK_TOOLS.has(name)) {
    const postErr = await verifyPages()
    if (postErr) {
      reply(id, toolError(postErr))
      return
    }
  }
  reply(id, resp.result)
}

async function handleParentMessage(msg: RpcMessage): Promise<void> {
  if (typeof msg.method !== 'string') return // respuesta inesperada del padre: se ignora
  const id: JsonRpcId = msg.id === undefined ? null : msg.id
  const isNotification = msg.id === undefined || msg.id === null

  if (msg.method === 'tools/list') {
    const resp = await callChild('tools/list', msg.params)
    if (resp.error) {
      reply(id, undefined, resp.error)
      return
    }
    const tools = extractTools(resp.result).filter((t) => !BLOCKED.has(t.name))
    allowedTools = new Set(tools.map((t) => t.name))
    const baseResult = resp.result && typeof resp.result === 'object' ? (resp.result as Record<string, unknown>) : {}
    reply(id, { ...baseResult, tools })
    return
  }

  if (msg.method === 'tools/call') {
    const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as { name?: unknown; arguments?: unknown }
    const name = typeof params.name === 'string' ? params.name : ''
    if (!allowedTools.has(name)) {
      reply(id, toolError(`Herramienta no permitida: "${name}".`))
      return
    }
    await handleToolCall(id, name, params.arguments, msg.params)
    return
  }

  // Cualquier otro método (initialize, ping, notifications/*…): reenvío transparente.
  if (isNotification) {
    writeMessage(child.stdin, { jsonrpc: '2.0', method: msg.method, params: msg.params })
    return
  }
  const resp = await callChild(msg.method, msg.params)
  reply(id, resp.result, resp.error)
}

lineReader(process.stdin, (msg) => {
  handleParentMessage(msg).catch((err: unknown) => {
    console.error('[browser-mcp] error al procesar un mensaje:', err)
    if (msg.id !== undefined && msg.id !== null) {
      reply(msg.id, toolError('Error interno de la pasarela del navegador.'))
    }
  })
})

function shutdown(): void {
  try {
    child.kill('SIGTERM')
  } catch {
    // ya no existe
  }
  setTimeout(() => {
    try {
      child.kill('SIGKILL')
    } catch {
      // ya no existe
    }
    process.exit(0)
  }, 3000)
}

process.stdin.on('end', shutdown)
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
