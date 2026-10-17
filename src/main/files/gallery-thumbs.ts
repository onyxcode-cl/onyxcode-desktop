/**
 * Miniaturas de la galería, todo dentro del equipo (nada de red, nada de programas externos):
 *  - imágenes reales reducidas (PNG/JPG/GIF/WebP/BMP, hasta 10 MB de origen) con una caché en `userData/gallery-thumbs`;
 *  - texto/Markdown/HTML: la primera línea con contenido (lectura de los primeros 4 KB);
 *  - Office y PDF: no se renderizan (la interfaz dibuja el ícono del tipo).
 * Módulo sin Electron: el reductor de imágenes se inyecta (`nativeImage` en la app, uno falso en las pruebas).
 */
import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { ChatFileInfo, GalleryThumbResult, GalleryType } from '@shared/ipc-extras'

export const THUMB_WIDTH = 320
export const MAX_THUMB_SOURCE_BYTES = 10 * 1024 * 1024
export const MAX_THUMB_BYTES = 256 * 1024
const MAX_CACHE_FILES = 600
const HEAD_BYTES = 4096
const MAX_LINE = 140
const RASTER = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

/** Reduce una imagen a `width` de ancho y la devuelve como PNG; `null` si no se pudo leer. */
export type ImageShrinker = (source: Buffer, width: number) => Buffer | null

function ext(path: string): string {
  const i = path.lastIndexOf('.')
  return i < 0 ? '' : path.slice(i).toLowerCase()
}

/** Primera línea útil de un texto: sin marcas de Markdown ni etiquetas HTML. Pura. */
export function firstLine(raw: string, type: GalleryType): string {
  let text = raw
  if (type === 'web') {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1]
    const body = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ')
    text = title && title.trim() ? title : body
  }
  for (const line of text.split(/\r?\n/)) {
    const clean = line
      .replace(/^[\s#>*\-+`|]+/, '')
      .replace(/[*_`]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (clean) return clean.length > MAX_LINE ? `${clean.slice(0, MAX_LINE - 1)}…` : clean
  }
  return ''
}

function readHead(path: string, max: number): Buffer {
  const fd = openSync(path, 'r')
  try {
    const buf = Buffer.alloc(max)
    const n = readSync(fd, buf, 0, max, 0)
    return buf.subarray(0, n)
  } finally {
    closeSync(fd)
  }
}

function pruneCache(dir: string): void {
  try {
    const files = readdirSync(dir).map((n) => ({ n, t: statSync(join(dir, n)).mtimeMs }))
    if (files.length <= MAX_CACHE_FILES) return
    files.sort((a, b) => a.t - b.t)
    for (const f of files.slice(0, files.length - MAX_CACHE_FILES)) unlinkSync(join(dir, f.n))
  } catch {
    // caché ilegible: se ignora
  }
}

/** Miniatura de un archivo YA validado (`info` sale de `resolveChatFile`). Nunca lanza. */
export function galleryThumb(
  info: ChatFileInfo,
  type: GalleryType,
  deps: { cacheDir: string; shrink: ImageShrinker; mtimeMs?: number }
): GalleryThumbResult {
  try {
    if (info.kind === 'blocked') return { kind: 'none' }
    if (type === 'image') {
      if (!RASTER.has(ext(info.path)) || info.bytes > MAX_THUMB_SOURCE_BYTES) return { kind: 'none' }
      const mtime = deps.mtimeMs ?? statSync(info.path).mtimeMs
      const key = createHash('sha1').update(`${info.path}\0${mtime}\0${info.bytes}`).digest('hex')
      const cached = join(deps.cacheDir, `${key}.png`)
      let png: Buffer | null = null
      if (existsSync(cached)) png = readFileSync(cached)
      else {
        png = deps.shrink(readFileSync(info.path), THUMB_WIDTH)
        if (png && png.length <= MAX_THUMB_BYTES) {
          mkdirSync(deps.cacheDir, { recursive: true, mode: 0o700 })
          writeFileSync(cached, png, { mode: 0o600 })
          pruneCache(deps.cacheDir)
        }
      }
      if (!png || png.length > MAX_THUMB_BYTES) return { kind: 'none' }
      return { kind: 'image', dataUrl: `data:image/png;base64,${png.toString('base64')}` }
    }
    if (type === 'text' || type === 'web') {
      const head = readHead(info.path, HEAD_BYTES)
      if (head.includes(0)) return { kind: 'none' }
      const line = firstLine(head.toString('utf8'), type)
      return line ? { kind: 'text', text: line } : { kind: 'none' }
    }
    return { kind: 'none' }
  } catch {
    return { kind: 'none' }
  }
}
