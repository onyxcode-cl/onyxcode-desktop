/**
 * Manejador del esquema `lazunox-viewer://viewer/…` (Fase 0 del plan del visor).
 *
 * Dos rutas:
 * - Estáticos del propio visor (`/`, `/index.html`, `/assets/…`): se sirven de `out/viewer/`, con
 *   el mismo cuidado que `security/app-protocol.ts` (sin `..`, sin enlaces fuera de la raíz).
 * - El documento a mostrar (`/doc/<token>`): el token lo emitió `tokens.ts` al abrir el archivo
 *   (`tasks:viewer:open`); acá se REVALIDA la carpeta con `assertPath` justo antes de leer los
 *   bytes (nunca confía en que la validación de apertura siga vigente — la carpeta pudo
 *   desaprobarse entretanto), se aplica el tope de tamaño por tipo y se cierra con CSP estricta.
 */
import { constants } from 'node:fs'
import { open, readFile, realpath, stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { extname, join, normalize, sep } from 'node:path'
import { VIEWER_SCHEME } from '../security/app-protocol'
import { viewerSession } from './session'
import { resolveToken } from './tokens'
import { MAX_BYTES, sniffDocKind, type DocKind } from './doc-kind'

const VIEWER_HOST = 'viewer'

/** CSP de la vista aislada del visor: sin red saliente, módulos/workers solo del propio esquema. */
export const VIEWER_CSP = [
  "default-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data: blob:",
  "connect-src 'self'",
  'media-src lazunox-viewer://viewer',
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

const DOC_MIME: Record<DocKind, string> = {
  mp4: 'video/mp4',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

const STATIC_MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8'
}

function baseHeaders(): Record<string, string> {
  return {
    'x-content-type-options': 'nosniff',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'referrer-policy': 'no-referrer',
    'cache-control': 'no-store',
    'content-security-policy': VIEWER_CSP
  }
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: baseHeaders() })
}

/** `out/viewer/`: mismo patrón que `rendererRoot()` de `app-protocol.ts` (`out/main` → `out/viewer`). */
function viewerRoot(): string {
  return join(__dirname, '..', 'viewer')
}

async function serveStatic(pathname: string): Promise<Response> {
  const root = viewerRoot()
  let rel = decodeURIComponent(pathname)
  if (rel === '/' || rel === '') rel = '/index.html'
  if (rel.includes('\0')) return notFound()
  const file = normalize(join(root, rel))
  if (!file.startsWith(root + sep)) return notFound()
  try {
    const real = await realpath(file)
    const realRoot = await realpath(root)
    if (!real.startsWith(realRoot + sep)) return notFound()
    const body = await readFile(real)
    const type = STATIC_MIME[extname(real).toLowerCase()] ?? 'application/octet-stream'
    return new Response(body, { status: 200, headers: { ...baseHeaders(), 'content-type': type } })
  } catch {
    return notFound()
  }
}

/**
 * Sirve el documento de un token: revalida la ruta con `assertPath` (p. ej.
 * `tasks.assertInsideApproved`) justo antes de leer, nunca confía en la validación de apertura.
 */
async function serveDoc(token: string, request: Request, assertPath: (path: string) => string): Promise<Response> {
  const payload = resolveToken(token)
  if (!payload) return notFound()
  let real: string
  try {
    real = assertPath(payload.path)
  } catch {
    return notFound()
  }
  try {
    const info = await stat(real)
    if (info.size > MAX_BYTES[payload.kind]) return new Response('Payload too large', { status: 413, headers: baseHeaders() })
    if (payload.kind === 'mp4') return await serveVideo(real, request)
    const body = await readFile(real)
    return new Response(body, { status: 200, headers: { ...baseHeaders(), 'content-type': DOC_MIME[payload.kind] } })
  } catch {
    return notFound()
  }
}

/** Un solo rango por petición, acotado por el tamaño real del descriptor abierto. */
async function serveVideo(path: string, request: Request): Promise<Response> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let streaming = false
  try {
    const info = await file.stat()
    const current = await stat(path)
    if (!info.isFile() || (await realpath(path)) !== path || current.dev !== info.dev || current.ino !== info.ino) return notFound()
    if (info.size > MAX_BYTES.mp4) return new Response('Payload too large', { status: 413, headers: baseHeaders() })
    const head = Buffer.alloc(Math.min(32, info.size))
    const { bytesRead } = await file.read(head, 0, head.length, 0)
    if (sniffDocKind(path, head.subarray(0, bytesRead)) !== 'mp4') return notFound()
    const range = request.headers.get('range')
    const bounds = range === null ? { start: 0, end: info.size - 1 } : videoRange(range, info.size)
    const headers = { ...baseHeaders(), 'content-type': 'video/mp4', 'accept-ranges': 'bytes' }
    if (!bounds) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${info.size}` } })
    const { start, end } = bounds
    const stream = file.createReadStream({ start, end, autoClose: true, highWaterMark: 64 * 1024 })
    const abort = (): void => {
      stream.destroy()
    }
    request.signal.addEventListener('abort', abort, { once: true })
    stream.once('close', () => request.signal.removeEventListener('abort', abort))
    if (request.signal.aborted) stream.destroy()
    streaming = true
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      status: range === null ? 200 : 206,
      headers: {
        ...headers,
        'content-length': String(end - start + 1),
        ...(range === null ? {} : { 'content-range': `bytes ${start}-${end}/${info.size}` })
      }
    })
  } finally {
    if (!streaming) await file.close()
  }
}

export function videoRange(value: string, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value)
  if (!match || (!match[1] && !match[2])) return null
  const a = Number(match[1]),
    b = Number(match[2])
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) return null
  const start = match[1] ? a : Math.max(0, size - b)
  const end = match[1] && match[2] ? Math.min(b, size - 1) : size - 1
  return start < 0 || start >= size || end < start || (!match[1] && b === 0) ? null : { start, end }
}

/**
 * Validadores de ruta registrados por cada quien abre documentos en el visor (hoy Tareas —
 * `tasks.assertInsideApproved` — y Chat — su propia carpeta temporal de documentos generados).
 * El visor es una sola vista nativa compartida por toda la app (un modo a la vez es visible), así
 * que comparte esquema/sesión/token: lo único que cambia por quién abre es QUÉ ruta es válida.
 */
const pathValidators: Array<(path: string) => string> = []

/** Agrega un validador a la cadena. Orden de registro = orden de intento; el primero que no lance gana. */
export function registerViewerPathValidator(assertPath: (path: string) => string): void {
  pathValidators.push(assertPath)
}

/** Prueba cada validador registrado en orden; lanza el último error si ninguno acepta la ruta. */
function assertPathRegistered(path: string): string {
  let lastErr: unknown
  for (const assertPath of pathValidators) {
    try {
      return assertPath(path)
    } catch (err) {
      lastErr = err
    }
  }
  throw lastErr ?? new Error('Ningún validador de ruta registrado')
}

let installed = false

/** Instala el manejador en la sesión del visor. Solo puede instalarse una vez por sesión. */
export function installViewerScheme(): void {
  if (installed) return
  installed = true
  viewerSession().protocol.handle(VIEWER_SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Bad request', { status: 400, headers: baseHeaders() })
    }
    if (url.host !== VIEWER_HOST || request.method !== 'GET') return notFound()
    const doc = /^\/doc\/([0-9a-f]{64})$/.exec(url.pathname)
    if (doc) return serveDoc(doc[1], request, assertPathRegistered)
    return serveStatic(url.pathname)
  })
}
