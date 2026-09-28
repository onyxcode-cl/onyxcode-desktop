/**
 * Esquema propio para el renderer de producción: `lapis://app/<ruta>` en vez de `file://`.
 *
 * - Registrado como privilegiado (`standard` + `secure`): origen estable `lapis://app`, contexto
 *   seguro, `fetch` y caché de código; sin los privilegios extra de `file://` (que además quedan
 *   desactivados con el fuse GrantFileProtocolExtraPrivileges).
 * - Solo sirve archivos de `out/renderer` (sin `..`, sin enlaces fuera de la raíz) y solo para el
 *   host `app`; cualquier otra cosa → 404.
 * - Cada respuesta HTML lleva CSP por CABECERA (la `<meta>` de los HTML se mantiene para el dev
 *   server; ambas se aplican y gana la intersección).
 */
import { app, protocol } from 'electron'
import { readFile, realpath } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { APP_SLUG } from '@shared/brand'

export const APP_SCHEME = APP_SLUG
export const APP_HOST = 'app'
/** Origen del renderer empaquetado (`lapis://app`). */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8'
}

/**
 * CSP del renderer. El cliente de OpenCode habla con `http://127.0.0.1:<puerto>` (sidecar y
 * servidores de Cowork); nada más sale a la red. Sin `unsafe-eval`, sin frames, sin objetos.
 */
export const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: http://127.0.0.1:*",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' http://127.0.0.1:*",
  "worker-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** Debe llamarse ANTES de `app.whenReady()`. */
export function registerAppSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true }
    }
  ])
}

function rendererRoot(): string {
  return join(__dirname, '..', 'renderer')
}

/** Instala el manejador del esquema en la sesión por defecto. Llamar tras `whenReady`. */
export function handleAppScheme(): void {
  const root = rendererRoot()
  protocol.handle(APP_SCHEME, async (request) => {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      return new Response('Bad request', { status: 400 })
    }
    if (url.host !== APP_HOST || request.method !== 'GET') return new Response('Not found', { status: 404 })
    let rel = decodeURIComponent(url.pathname)
    if (rel === '/' || rel === '') rel = '/index.html'
    if (rel.includes('\0')) return new Response('Not found', { status: 404 })
    const file = normalize(join(root, rel))
    if (!file.startsWith(root + sep)) return new Response('Not found', { status: 404 })
    try {
      // Sin enlaces simbólicos que salgan de la raíz (el paquete no tiene ninguno).
      const real = await realpath(file)
      const realRoot = await realpath(root)
      if (!real.startsWith(realRoot + sep)) return new Response('Not found', { status: 404 })
      const body = await readFile(real)
      const type = MIME[extname(real).toLowerCase()] ?? 'application/octet-stream'
      const headers: Record<string, string> = {
        'content-type': type,
        'x-content-type-options': 'nosniff',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-resource-policy': 'same-origin',
        'referrer-policy': 'no-referrer',
        'cache-control': 'no-cache'
      }
      if (type.startsWith('text/html')) headers['content-security-policy'] = RENDERER_CSP
      return new Response(body, { status: 200, headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/** URL del dev server de Vite (solo sin empaquetar). */
export function devRendererUrl(): string | null {
  const url = process.env.ELECTRON_RENDERER_URL
  if (app.isPackaged || !url) return null
  return url.replace(/\/$/, '')
}

/** Origen del dev server (para CORS de OpenCode y validación de emisor), o null. */
export function devRendererOrigin(): string | null {
  const url = devRendererUrl()
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** Orígenes desde los que la app carga sus propias páginas. */
export function trustedOrigins(): string[] {
  const dev = devRendererOrigin()
  return dev ? [APP_ORIGIN, dev] : [APP_ORIGIN]
}

/** URL de una página del renderer (`index.html`, `quick/index.html`, `overlay/pill.html`…). */
export function rendererPageUrl(page: string): string {
  const clean = page.replace(/^\/+/, '')
  const dev = devRendererUrl()
  return dev ? `${dev}/${clean}` : `${APP_ORIGIN}/${clean}`
}

/** ¿La URL pertenece a un origen propio? */
export function isTrustedUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return trustedOrigins().includes(u.origin)
  } catch {
    return false
  }
}
