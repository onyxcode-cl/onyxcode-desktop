/**
 * Imágenes de internet en presentaciones y documentos HTML que genera la IA, SIN dar red a la ventana.
 *
 * La ventana de artifacts (`artifact-window.ts`) no tiene red: su CSP solo admite `data:`/`blob:` y cancela cualquier petición http(s).
 * Para que una presentación con fotos de la web se vea, la APP (no la página) descarga las imágenes y las incrusta como `data:` antes de
 * servir el HTML. Límites, pensados para que esto no sirva para sacar datos ni para tocar la red local:
 *  - solo `https`, sin usuario ni puerto raro, URL de hasta 400 caracteres;
 *  - solo dominios de bancos de imágenes conocidos (`ALLOWED_IMAGE_HOSTS`); cualquier otro se sustituye por una imagen gris que lo explica;
 *  - cada redirección se vuelve a validar; el dominio no puede resolver a una red privada, local o de enlace local;
 *  - sin cookies ni credenciales, máximo 24 imágenes, 6 MB cada una y 40 MB en total, 12 s por imagen;
 *  - se comprueba el contenido real (PNG, JPEG, GIF, WebP o AVIF); un SVG o cualquier otra cosa se descarta.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export const ALLOWED_IMAGE_HOSTS: readonly string[] = [
  'images.unsplash.com',
  'plus.unsplash.com',
  'images.pexels.com',
  'cdn.pixabay.com',
  'upload.wikimedia.org',
  'live.staticflickr.com'
]
export const MAX_IMAGES = 24
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024
export const MAX_URL_LENGTH = 400
const TIMEOUT_MS = 12_000
const MAX_REDIRECTS = 3
const CONCURRENCY = 4

export interface InlineDeps {
  fetchImpl?: (url: string, init: RequestInit) => Promise<Response>
  /** Resuelve el dominio a sus direcciones IP (inyectable para las pruebas). */
  resolveHost?: (host: string) => Promise<string[]>
}

export interface InlineResult {
  html: string
  inlined: number
  blocked: string[]
}

/** ¿La URL se puede pedir? Solo https, dominio permitido, sin credenciales y de largo razonable. */
export function isAllowedImageUrl(raw: string): boolean {
  if (raw.length > MAX_URL_LENGTH) return false
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  if (u.port && u.port !== '443') return false
  if (isIP(u.hostname)) return false
  return ALLOWED_IMAGE_HOSTS.includes(u.hostname.toLowerCase())
}

/** Direcciones que nunca se piden: loopback, privadas, de enlace local, CGNAT, multicast y reservadas (IPv4 e IPv6). */
export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase()
  if (v.includes(':')) {
    if (v === '::1' || v === '::') return true
    if (v.startsWith('fe80') || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('ff')) return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v)
    return mapped ? isPrivateAddress(mapped[1]) : false
  }
  const p = v.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

/** Tipo real de la imagen según sus primeros bytes, o `null` si no es un formato admitido (el SVG queda fuera a propósito). */
export function sniffImage(buf: Uint8Array): string | null {
  const b = buf
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'image/webp'
  if (
    b.length >= 12 &&
    b[4] === 0x66 &&
    b[5] === 0x74 &&
    b[6] === 0x79 &&
    b[7] === 0x70 &&
    b[8] === 0x61 &&
    b[9] === 0x76 &&
    b[10] === 0x69 &&
    b[11] === 0x66
  )
    return 'image/avif'
  return null
}

const decodeAmp = (s: string): string => s.replace(/&amp;/g, '&')

/** Textos de URL `https://…` que el HTML usa como imagen: `<img src>` y `url(…)` de CSS. Devuelve texto original → URL ya decodificada. */
export function extractImageRefs(html: string): Map<string, string> {
  const out = new Map<string, string>()
  const imgTag = /<img\b[^>]*>/gi
  for (const tag of html.match(imgTag) ?? []) {
    for (const m of tag.matchAll(/\bsrc\s*=\s*(["'])(https:\/\/[^"']*?)\1/gi)) out.set(m[2], decodeAmp(m[2]))
  }
  for (const m of html.matchAll(/url\(\s*(["']?)(https:\/\/[^"')\s]+)\1\s*\)/gi)) out.set(m[2], decodeAmp(m[2]))
  return out
}

const PLACEHOLDER_SVG = (why: string): string =>
  `data:image/svg+xml;base64,${Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360"><rect width="640" height="360" fill="#3a3f4b"/><text x="320" y="180" fill="#c9ced8" font-family="sans-serif" font-size="20" text-anchor="middle">${why}</text></svg>`
  ).toString('base64')}`

async function readCapped(res: Response, cap: number): Promise<Uint8Array | null> {
  const declared = Number(res.headers.get('content-length') ?? '0')
  if (declared > cap) return null
  if (!res.body) return null
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > cap) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const buf = new Uint8Array(total)
  let o = 0
  for (const c of chunks) {
    buf.set(c, o)
    o += c.byteLength
  }
  return buf
}

async function fetchOne(url: string, deps: Required<InlineDeps>): Promise<{ mime: string; data: Uint8Array } | null> {
  let current = url
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!isAllowedImageUrl(current)) return null
    const host = new URL(current).hostname
    const addrs = await deps.resolveHost(host).catch(() => [] as string[])
    if (addrs.length === 0 || addrs.some(isPrivateAddress)) return null
    const res = await deps
      .fetchImpl(current, {
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        // Wikimedia y otros bancos exigen un User-Agent que diga quién pide; no lleva nada de la persona.
        headers: {
          accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9',
          'user-agent': 'Lazunox (https://github.com/onyxcode-cl/onyxcode-desktop)'
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      })
      .catch(() => null)
    if (!res) return null
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return null
      try {
        current = new URL(loc, current).toString()
      } catch {
        return null
      }
      continue
    }
    if (res.status !== 200) return null
    const data = await readCapped(res, MAX_IMAGE_BYTES).catch(() => null)
    if (!data) return null
    const mime = sniffImage(data)
    return mime ? { mime, data } : null
  }
  return null
}

/** Descarga las imágenes de internet del HTML (con los límites de arriba) y las sustituye por `data:`. Nunca lanza: lo que falla queda como imagen gris. */
export async function inlineRemoteImages(html: string, deps: InlineDeps = {}): Promise<InlineResult> {
  const d: Required<InlineDeps> = {
    fetchImpl: deps.fetchImpl ?? ((u, i) => fetch(u, i)),
    resolveHost: deps.resolveHost ?? (async (h) => (await lookup(h, { all: true })).map((a) => a.address))
  }
  const refs = extractImageRefs(html)
  if (refs.size === 0) return { html, inlined: 0, blocked: [] }

  const entries = [...refs.entries()]
  const blocked: string[] = []
  const replacements = new Map<string, string>()
  let total = 0
  let inlined = 0

  const todo = entries.slice(0, MAX_IMAGES)
  for (const [raw] of entries.slice(MAX_IMAGES)) {
    replacements.set(raw, PLACEHOLDER_SVG('Demasiadas imágenes'))
    blocked.push(raw)
  }

  let next = 0
  const worker = async (): Promise<void> => {
    while (next < todo.length) {
      const [raw, url] = todo[next++]
      const allowed = isAllowedImageUrl(url)
      const got = allowed ? await fetchOne(url, d) : null
      if (got && total + got.data.byteLength <= MAX_TOTAL_BYTES) {
        total += got.data.byteLength
        inlined++
        replacements.set(raw, `data:${got.mime};base64,${Buffer.from(got.data).toString('base64')}`)
      } else {
        blocked.push(raw)
        replacements.set(raw, PLACEHOLDER_SVG(allowed ? 'Imagen no disponible' : 'Imagen de un sitio no permitido'))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker))

  let out = html
  for (const [raw, data] of replacements) out = out.split(raw).join(data)
  return { html: out, inlined, blocked }
}
