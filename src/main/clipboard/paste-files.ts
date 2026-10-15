/**
 * Lectura VALIDADA del portapapeles del sistema para pegar archivos o imágenes en el compositor.
 *
 * Por qué existe: en Electron un archivo copiado en Finder (`public.file-url` / NSFilenamesPboardType) o en el
 * Explorador (CF_HDROP / `FileNameW`) no siempre llega al evento `paste` como `File`; una captura sí puede llegar
 * como `image/png`, pero no siempre. Si la vía estándar viene vacía, el renderer pide esto (solo dentro de un evento
 * paste del usuario) y main lee el portapapeles real.
 *
 * Seguridad: el renderer NUNCA pasa rutas; las rutas salen del portapapeles y se validan aquí: absolutas, sin NUL,
 * solo archivos regulares (nada de carpetas, enlaces simbólicos ni dispositivos), sin ejecutables/lanzadores,
 * con topes de cantidad (10), tamaño por archivo (25 MB) y total (50 MB). Se abre el archivo y se re-comprueba
 * con `fstat` sobre el descriptor para no depender de la comprobación previa (carrera).
 */
import { t } from '@shared/i18n'
import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { basename, extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PASTE_MAX_FILE_BYTES,
  PASTE_MAX_FILES,
  PASTE_MAX_TOTAL_BYTES,
  type PasteFile,
  type PasteRejected,
  type PasteResult,
  type PasteScope
} from '@shared/paste-files'
import { BLOCKED_OPEN_EXTENSIONS } from '../tasks/open-policy'

/**
 * Lo mínimo del portapapeles de Electron que usamos (inyectable en pruebas). En Electron 44 el módulo `clipboard` es
 * asíncrono (`read()` → `ClipboardItem[]`); los formatos nativos se piden como MIME o con
 * `electron application/osclipboard;format="<formato nativo>"`.
 */
export interface ClipboardReader {
  /** Bytes del formato (MIME o nativo, p.ej. `NSFilenamesPboardType`, `public.file-url`, `FileNameW`), o `null` si no está. */
  readRaw(format: string): Promise<Buffer | null>
  /** PNG de la imagen del portapapeles, o `null` si no hay. */
  readImagePng(): Promise<Buffer | null>
}

const MAX_PATH_CHARS = 4096
/** Tope de entradas que se examinan en la lista del portapapeles (evita un plist gigante). */
const MAX_CANDIDATES = 50

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}
const OTHER_MIME: Record<string, string> = { '.pdf': 'application/pdf' }

export function mimeForName(name: string): string {
  const ext = extname(name).toLowerCase()
  return IMAGE_MIME[ext] ?? OTHER_MIME[ext] ?? 'application/octet-stream'
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** `NSFilenamesPboardType`: plist XML con `<string>/ruta</string>` por archivo. */
export function parseFilenamesPlist(xml: string): string[] {
  const out: string[] = []
  const re = /<string>([^<]*)<\/string>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) && out.length < MAX_CANDIDATES) out.push(decodeXml(m[1]!))
  return out
}

/** `FileNameW` (Windows): UTF-16LE terminado en NUL (puede traer varias rutas separadas por NUL). */
export function parseFileNameW(buf: Buffer): string[] {
  return buf
    .toString('utf16le')
    .split('\0')
    .filter((s) => s.length > 0)
    .slice(0, MAX_CANDIDATES)
}

/** `file:///ruta` → ruta local; `null` si no es una URL de archivo local (otro host, UNC, mal formada). */
export function fileUrlToLocalPath(url: string): string | null {
  const line = url.split(/\r?\n/)[0]?.trim() ?? ''
  if (!line.toLowerCase().startsWith('file:')) return null
  try {
    return fileURLToPath(line)
  } catch {
    return null
  }
}

/** `text/uri-list`: una URL `file:` por línea (varios archivos). */
export function parseUriList(text: string): string[] {
  const out: string[] = []
  for (const line of text.split(/\r?\n/).slice(0, MAX_CANDIDATES)) {
    if (line.startsWith('#')) continue
    const p = fileUrlToLocalPath(line)
    if (p) out.push(p)
  }
  return out
}

/** Rutas de archivos copiados que hay en el portapapeles, según la plataforma. Nunca lanza. */
export async function readClipboardPaths(cb: ClipboardReader, platform: NodeJS.Platform): Promise<string[]> {
  const out: string[] = []
  const add = (list: (string | null)[]): void => {
    for (const p of list) if (p && !out.includes(p) && out.length < MAX_CANDIDATES) out.push(p)
  }
  const raw = async (format: string): Promise<Buffer | null> => {
    try {
      return await cb.readRaw(format)
    } catch {
      return null // formato ilegible: se trata como ausente
    }
  }
  if (platform === 'darwin') {
    const plist = await raw('NSFilenamesPboardType')
    if (plist) add(parseFilenamesPlist(plist.toString('utf8')))
    if (out.length === 0) {
      const url = await raw('public.file-url')
      if (url) add([fileUrlToLocalPath(url.toString('utf8'))])
    }
  } else if (platform === 'win32') {
    const w = await raw('FileNameW')
    if (w) add(parseFileNameW(w))
  }
  if (out.length === 0) {
    const list = await raw('text/uri-list')
    if (list) add(parseUriList(list.toString('utf8')))
  }
  return out
}

function isImageName(name: string): boolean {
  return extname(name).toLowerCase() in IMAGE_MIME
}

async function readOne(
  path: string,
  scope: PasteScope,
  platform: NodeJS.Platform,
  budget: { left: number }
): Promise<PasteFile | PasteRejected> {
  const name = basename(path) || t('chat.attach.defaultName')
  const bad = (reason: PasteRejected['reason']): PasteRejected => ({ name, reason })
  if (!isAbsolute(path) || path.includes('\0') || path.length > MAX_PATH_CHARS) return bad('notRegular')
  if (BLOCKED_OPEN_EXTENSIONS.has(extname(path).toLowerCase())) return bad('blockedType')
  if (scope === 'images' && !isImageName(name)) return bad('blockedType')
  let handle
  try {
    const l = await lstat(path)
    // Carpetas, enlaces simbólicos, dispositivos, sockets…: no se pegan.
    if (!l.isFile()) return bad('notRegular')
    // O_NOFOLLOW/O_NONBLOCK no existen en Windows; allí ya sabemos que es un archivo regular.
    const flags = platform === 'win32' ? constants.O_RDONLY : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    handle = await open(path, flags)
    const st = await handle.stat()
    if (!st.isFile()) return bad('notRegular')
    // Lanzadores sin extensión conocida: bit de ejecución (en Windows el modo no significa nada).
    if (platform !== 'win32' && (st.mode & 0o111) !== 0) return bad('blockedType')
    if (st.size > PASTE_MAX_FILE_BYTES) return bad('tooBig')
    if (st.size > budget.left) return bad('tooBigTotal')
    const buf = Buffer.alloc(st.size)
    let off = 0
    while (off < buf.length) {
      const { bytesRead } = await handle.read(buf, off, buf.length - off, off)
      if (bytesRead === 0) break
      off += bytesRead
    }
    budget.left -= off
    return { name, mime: mimeForName(name), size: off, base64: buf.subarray(0, off).toString('base64') }
  } catch {
    return bad('unreadable')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Lee del portapapeles archivos copiados (prioridad) o, si no hay, la imagen. Aplica todos los topes.
 * `platform` y `cb` son inyectables para probar sin Electron.
 */
export async function readPasteFiles(
  cb: ClipboardReader,
  scope: PasteScope,
  platform: NodeJS.Platform = process.platform
): Promise<PasteResult> {
  const files: PasteFile[] = []
  const rejected: PasteRejected[] = []
  const paths = await readClipboardPaths(cb, platform)
  if (paths.length > 0) {
    const budget = { left: PASTE_MAX_TOTAL_BYTES }
    for (const p of paths) {
      if (files.length >= PASTE_MAX_FILES) {
        rejected.push({ name: basename(p), reason: 'tooMany' })
        continue
      }
      const r = await readOne(p, scope, platform, budget)
      if ('base64' in r) files.push(r)
      else rejected.push(r)
    }
    return { files, rejected }
  }
  let png: Buffer | null = null
  try {
    png = await cb.readImagePng()
  } catch {
    png = null
  }
  if (png && png.length > 0) {
    const name = t('chat.paste.imageName')
    if (png.length > PASTE_MAX_FILE_BYTES) rejected.push({ name, reason: 'tooBig' })
    else files.push({ name, mime: 'image/png', size: png.length, base64: png.toString('base64') })
  }
  return { files, rejected }
}
