/**
 * Imágenes de la carpeta de la tarea para incrustarlas en un documento (PowerPoint y Word). El agente solo escribe una ruta RELATIVA; esta capa
 *  1. la lee con las mismas comprobaciones que `documentos_renderizar` (`readTaskFile` en modo imagen: sin `..`, sin enlaces, dentro de la
 *     carpeta, mismo inodo, tope de 5 MB, extensión de imagen);
 *  2. exige que los PRIMEROS BYTES sean de verdad PNG, JPEG, GIF o WebP (la extensión no basta) y lee su tamaño en píxeles (tope de píxeles);
 *  3. escribe una COPIA en un directorio temporal propio de la app, con un nombre que ella elige: los programas de ArtCraft reciben esa copia,
 *     nunca la ruta original ni nada que haya escrito el modelo.
 * Sin red: no hay imágenes remotas. El Chat (sin carpeta de tarea) no pasa por aquí y por tanto no recibe imágenes.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_IMAGES_PER_DOC } from '@shared/chat-doc-spec'
import { privateTmp } from '../office/craft/private-tmp'
import { readTaskFile } from './input-path'
import { OutputPathError } from './output-path'

/** Más píxeles que esto (≈ 40 megapíxeles) y la imagen se rechaza: un archivo chico puede descomprimirse a algo enorme. */
export const MAX_IMAGE_PIXELS = 40_000_000
/** Suma de bytes de todas las imágenes de un documento. */
export const MAX_IMAGES_TOTAL_BYTES = 20 * 1024 * 1024

export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp'
export interface ImageInfo {
  kind: ImageKind
  mime: string
  /** Extensión que se usa en la copia temporal (según la firma, no según el nombre original). */
  ext: string
  width: number
  height: number
}

const MIME: Record<ImageKind, string> = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }
const EXT: Record<ImageKind, string> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }

/** Tipo y tamaño en píxeles de una imagen por sus primeros bytes, o `null` si no es PNG/JPEG/GIF/WebP o está truncada. */
export function sniffImage(b: Buffer): ImageInfo | null {
  const make = (kind: ImageKind, width: number, height: number): ImageInfo | null =>
    width > 0 && height > 0 ? { kind, mime: MIME[kind], ext: EXT[kind], width, height } : null
  // PNG: firma de 8 bytes + IHDR (ancho y alto de 4 bytes big-endian en 16 y 20).
  if (
    b.length >= 24 &&
    b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
    b.toString('latin1', 12, 16) === 'IHDR'
  )
    return make('png', b.readUInt32BE(16), b.readUInt32BE(20))
  // GIF: «GIF87a»/«GIF89a» + ancho y alto de 2 bytes little-endian.
  if (b.length >= 10 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a'))
    return make('gif', b.readUInt16LE(6), b.readUInt16LE(8))
  // JPEG: FF D8 FF y primer marcador SOFn (C0–CF salvo C4, C8, CC) con alto y ancho.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++
        continue
      }
      const m = b[i + 1]
      if (m === 0xff) {
        i++
        continue
      }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return make('jpeg', b.readUInt16BE(i + 7), b.readUInt16BE(i + 5))
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
        i += 2
        continue
      }
      i += 2 + b.readUInt16BE(i + 2)
    }
    return null
  }
  // WebP: «RIFF»…«WEBP» + VP8 (con pérdida), VP8L (sin pérdida) o VP8X (extendido).
  if (b.length >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const chunk = b.toString('latin1', 12, 16)
    if (chunk === 'VP8 ' && b.length >= 30) return make('webp', b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff)
    if (chunk === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
      const bits = b.readUInt32LE(21)
      return make('webp', (bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
    }
    if (chunk === 'VP8X') return make('webp', 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), 1 + (b[27] | (b[28] << 8) | (b[29] << 16)))
  }
  return null
}

export interface ResolvedImage extends ImageInfo {
  /** Copia temporal propia (ruta absoluta que la app eligió): es lo único que se le da a ArtCraft. */
  file: string
  bytes: number
}
/** Ruta que escribió el modelo (relativa) → imagen ya validada y copiada. */
export type ImageMap = ReadonlyMap<string, ResolvedImage>

export interface PreparedImages {
  images: ImageMap
  /** Borra las copias temporales; llamarlo SIEMPRE (también si el documento falla). */
  cleanup: () => Promise<void>
}

/**
 * Lee, valida y copia todas las imágenes pedidas. Lanza `OutputPathError` (mensaje apto para el agente) ante la primera ruta mala, y en ese
 * caso no deja nada en disco. `readFile` solo se inyecta para probar.
 */
export async function prepareImages(
  root: string,
  paths: readonly string[],
  agentRoots: string[] = [],
  readFile: typeof readTaskFile = readTaskFile
): Promise<PreparedImages> {
  if (paths.length > MAX_IMAGES_PER_DOC)
    throw new OutputPathError('size', `Demasiadas imágenes: el máximo es ${MAX_IMAGES_PER_DOC} por documento.`)
  const map = new Map<string, ResolvedImage>()
  if (paths.length === 0) return { images: map, cleanup: async () => undefined }
  const dir = await mkdtemp(join(await privateTmp(), 'lazunox-img-'))
  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => undefined)
  }
  try {
    let total = 0
    let n = 0
    for (const p of paths) {
      const f = await readFile(root, p, agentRoots, {}, 'image')
      const info = sniffImage(f.bytes)
      if (!info) throw new OutputPathError('name', `«${p}» no es una imagen PNG, JPEG, WebP o GIF válida.`)
      if (info.width * info.height > MAX_IMAGE_PIXELS)
        throw new OutputPathError('size', `«${p}» tiene demasiados píxeles (${info.width}×${info.height}).`)
      total += f.bytes.length
      if (total > MAX_IMAGES_TOTAL_BYTES)
        throw new OutputPathError('size', 'Las imágenes del documento pesan demasiado en total (máx. 20 MB).')
      n++
      const file = join(dir, `img-${n}.${info.ext}`)
      await writeFile(file, f.bytes, { mode: 0o600 })
      map.set(p, { ...info, file, bytes: f.bytes.length })
    }
    return { images: map, cleanup }
  } catch (e) {
    await cleanup()
    throw e
  }
}
