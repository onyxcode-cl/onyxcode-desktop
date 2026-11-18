/** Entradas declarativas acotadas. Las rutas siempre se resuelven contra un ámbito concedido por main. */
import { constants } from 'node:fs'
import { lstat, open, realpath, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { relativeInputPath } from '../documents/input-path'
import { sniffImage, MAX_IMAGE_PIXELS } from '../documents/image-files'
import { isFreeImagePreview } from '../documents/free-image-preview'

export const MAX_TEXT_FILE = 512 * 1024
export const MAX_TEXT_TOTAL = 4 * 1024 * 1024
export const MAX_TEXT_FILES = 64
export const MAX_MEDIA_FILE = 32 * 1024 * 1024
export const MAX_MEDIA_TOTAL = 96 * 1024 * 1024
export const FONT_FAMILIES =
  'Inter, Montserrat, Outfit, Nunito, Oswald, League Gothic, Archivo Black, Space Mono, IBM Plex Mono, JetBrains Mono, EB Garamond, Playfair Display, Source Code Pro, Noto Sans JP, Roboto, Open Sans, Lato, Poppins'

export function projectPath(raw: unknown): string {
  if (typeof raw !== 'string' || raw.includes('\\') || raw.split('/').some((s) => s === '' || s === '.' || s === '..'))
    throw Error('Usa una ruta relativa normal, sin .. ni rutas absolutas.')
  return relativeInputPath(raw).join('/')
}
export function textFiles(raw: unknown): [string, string][] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('archivos debe ser un objeto de rutas y texto.')
  const entries = Object.entries(raw)
  if (!entries.length || entries.length > MAX_TEXT_FILES) throw Error('archivos admite entre 1 y 64 archivos.')
  let total = 0
  const paths = new Set<string>()
  return entries.map(([name, text]) => {
    const path = projectPath(name)
    if (!/\.(html|css|js|json|svg)$/i.test(path) || typeof text !== 'string' || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text))
      throw Error('archivos solo admite texto HTML, CSS, JS, JSON o SVG, sin bytes binarios.')
    const size = Buffer.byteLength(text)
    total += size
    if (size > MAX_TEXT_FILE || total > MAX_TEXT_TOTAL) throw Error('archivos supera 512 KiB por archivo o 4 MiB en total.')
    if (paths.has(path.toLowerCase())) throw Error('Hay rutas repetidas en archivos.')
    paths.add(path.toLowerCase())
    return [path, text]
  })
}
export interface PhotoInput {
  origen: string
  destino: string
}
export function photoInputs(raw: unknown): PhotoInput[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 24) throw Error('fotos admite hasta 24 fotos.')
  const paths = new Set<string>()
  return raw.map((p) => {
    if (
      !p ||
      typeof p !== 'object' ||
      Object.keys(p).some((k) => !['origen', 'destino'].includes(k)) ||
      typeof p.origen !== 'string' ||
      !p.origen ||
      p.origen.length > 4000
    )
      throw Error('Cada foto requiere origen y destino.')
    const destino = projectPath(p.destino)
    if (!/^assets\/.+\.(png|jpe?g|webp|gif)$/i.test(destino) || paths.has(destino.toLowerCase()))
      throw Error('destino requiere una imagen única en assets/.')
    paths.add(destino.toLowerCase())
    return { origen: p.origen, destino }
  })
}
export interface AudioInput {
  origen: string
  inicio: number
  desde: number
  hasta?: number
  volumen: number
  fundidoEntrada: number
  fundidoSalida: number
}
export function audioInputs(raw: unknown): AudioInput[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 16) throw Error('audio admite hasta 16 pistas.')
  return raw.map((p) => {
    if (
      !p ||
      typeof p !== 'object' ||
      Object.keys(p).some((k) => !['origen', 'inicio', 'desde', 'hasta', 'volumen', 'fundidoEntrada', 'fundidoSalida'].includes(k)) ||
      typeof p.origen !== 'string' ||
      !p.origen ||
      p.origen.length > 4000
    )
      throw Error('Cada pista requiere un origen de audio local o HTTPS.')
    const out = {
      origen: p.origen,
      inicio: p.inicio ?? 0,
      desde: p.desde ?? 0,
      hasta: p.hasta,
      volumen: p.volumen ?? 1,
      fundidoEntrada: p.fundidoEntrada ?? 0,
      fundidoSalida: p.fundidoSalida ?? 0
    }
    for (const k of ['inicio', 'desde', 'volumen', 'fundidoEntrada', 'fundidoSalida'] as const)
      if (
        typeof out[k] !== 'number' ||
        !Number.isFinite(out[k]) ||
        out[k] < 0 ||
        out[k] > (k === 'volumen' ? 3.98 : k === 'desde' ? 86400 : 120)
      )
        throw Error('Los tiempos de audio y el volumen deben ser números dentro de sus límites.')
    if (
      out.hasta !== undefined &&
      (typeof out.hasta !== 'number' || !Number.isFinite(out.hasta) || out.hasta <= out.desde || out.hasta > 86400)
    )
      throw Error('hasta debe ser mayor que desde y menor de un día.')
    return out
  })
}
export function validatePhoto(bytes: Buffer): void {
  const info = sniffImage(bytes)
  if (!info || bytes.length > MAX_MEDIA_FILE || info.width * info.height > MAX_IMAGE_PIXELS || isFreeImagePreview(bytes))
    throw Error('La foto debe ser PNG, JPEG, WebP o GIF, hasta 32 MiB y 40 megapíxeles; no una vista previa.')
}
/** Descriptor sin enlaces, lectura acotada y doble recorrido de identidades, también en Windows. */
export async function readMedia(
  root: string,
  raw: string,
  kind: 'photo' | 'audio',
  signal: AbortSignal,
  agentRoots: string[] = []
): Promise<Buffer> {
  const anchor = await realpath(root)
  const parts = relativeInputPath(raw, [root, anchor, ...agentRoots])
  if (!(kind === 'photo' ? /\.(png|jpe?g|webp|gif)$/i : /\.(mp3|m4a|wav|aac|ogg)$/i).test(parts.at(-1)!))
    throw Error('Formato de recurso no admitido.')
  const walk = async () => {
    let p = anchor
    const ids: string[] = []
    for (const [i, s] of parts.entries()) {
      p = join(p, s)
      const st = await lstat(p)
      if (st.isSymbolicLink() || (i < parts.length - 1 ? !st.isDirectory() : !st.isFile() || st.nlink !== 1))
        throw Error('El recurso debe ser un archivo normal sin enlaces.')
      ids.push(`${st.dev}:${st.ino}`)
    }
    return { path: p, ids: ids.join('|') }
  }
  const first = await walk()
  const fh = await open(
    first.path,
    constants.O_RDONLY | (process.platform === 'darwin' ? 0x20000000 : (constants.O_NOFOLLOW ?? 0)) | (constants.O_NONBLOCK ?? 0)
  )
  try {
    const st = await fh.stat()
    if (!st.isFile() || st.nlink !== 1 || st.size > MAX_MEDIA_FILE || !first.ids.endsWith(`${st.dev}:${st.ino}`))
      throw Error('El recurso cambió o supera 32 MiB.')
    const bytes = Buffer.alloc(st.size + 1)
    let n = 0
    while (n < bytes.length) {
      signal.throwIfAborted()
      const r = await fh.read(bytes, n, bytes.length - n, n)
      if (!r.bytesRead) break
      n += r.bytesRead
    }
    const after = await fh.stat()
    if (
      n !== st.size ||
      after.size !== st.size ||
      after.mtimeMs !== st.mtimeMs ||
      after.ctimeMs !== st.ctimeMs ||
      (await walk()).ids !== first.ids ||
      (await realpath(dirname(first.path))) !== dirname(first.path)
    )
      throw Error('El recurso cambió durante la lectura.')
    const result = bytes.subarray(0, n)
    if (kind === 'photo') validatePhoto(result)
    return result
  } finally {
    await fh.close()
  }
}

/** Presupuesto de la composición persistente, también al mandar cambios incrementales en Chat. */
export async function checkProjectUpdate(base: string, updates: { path: string; size: number }[], signal: AbortSignal): Promise<void> {
  const sizes = new Map<string, { path: string; size: number }>()
  const dirs = new Set<string>()
  const walk = async (dir: string, prefix = ''): Promise<void> => {
    signal.throwIfAborted()
    let st
    try {
      st = await lstat(dir)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !prefix) return
      throw error
    }
    if (!st.isDirectory() || st.isSymbolicLink() || (await realpath(dir)) !== dir) throw Error('La composición no puede contener enlaces.')
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix + entry.name
      const file = join(dir, entry.name),
        info = await lstat(file)
      if (info.isSymbolicLink()) throw Error('La composición no puede contener enlaces.')
      if (info.isDirectory()) {
        dirs.add(path.toLowerCase())
        await walk(file, path + '/')
      } else {
        if (!info.isFile() || info.nlink !== 1 || info.size > (/\.(mp3|m4a|wav|aac|ogg)$/i.test(path) ? 50 * 1024 * 1024 : MAX_MEDIA_FILE))
          throw Error('La composición tiene un archivo no admitido.')
        sizes.set(path.toLowerCase(), { path, size: info.size })
      }
      if (sizes.size + dirs.size > 256) throw Error('La composición supera 256 entradas.')
    }
  }
  await walk(base)
  for (const update of updates) {
    const path = projectPath(update.path)
    sizes.set(path.toLowerCase(), { path, size: update.size })
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/').toLowerCase())
  }
  const all = [...sizes.values()],
    texts = all.filter((f) => /\.(html|css|js|json|svg)$/i.test(f.path))
  if (sizes.size + dirs.size > 256 || all.reduce((n, f) => n + f.size, 0) > 128 * 1024 * 1024)
    throw Error('La composición supera 256 entradas o 128 MiB.')
  if (texts.length > MAX_TEXT_FILES || texts.reduce((n, f) => n + f.size, 0) > MAX_TEXT_TOTAL)
    throw Error('El proyecto de Chat supera 64 archivos de texto o 4 MiB de texto.')
}
