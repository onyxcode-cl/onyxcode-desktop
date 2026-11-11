/**
 * Ruta de salida de la herramienta `documentos`: el agente NUNCA elige dónde se escribe. Solo puede pedir un nombre y, a lo sumo,
 * una subcarpeta RELATIVA dentro de la carpeta de su tarea (la que la atadura del token le concede). Aquí se valida todo eso y se
 * escribe el archivo sin pisar nada: escritura segura (`tasks/safe-write.ts`: temporal verificado después de abrir y `link`), sufijo
 * « (2)» si el nombre existe y sin enlaces en el camino. Solo builtins de Node, `segmentProblem` (que ya usan WSL y los visores) y las
 * piezas puras de `tasks/no-follow.ts` y `tasks/safe-write.ts`.
 */
import { lstat, mkdir, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { segmentProblem } from '@shared/wsl-paths'
import { LinkRefusedError } from '../tasks/no-follow'
import { SafeTempFile } from '../tasks/safe-write'

export const MAX_SUBFOLDERS = 4
export const MAX_NAME_LENGTH = 80
const MAX_SUFFIX = 20

export type OutputErrorCode = 'name' | 'subfolder' | 'outside' | 'exists' | 'size' | 'io'

export class OutputPathError extends Error {
  constructor(
    readonly code: OutputErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OutputPathError'
  }
}

/** Nombre limpio para el archivo (sin extensión ni separadores). Lo que no es letra, número, espacio, `_` o `-` se quita. */
export function cleanName(raw: unknown, fallback = 'documento'): string {
  const text = typeof raw === 'string' ? raw : ''
  let name = text.replace(/\.[A-Za-z0-9]{1,5}$/, '') // si el agente puso «informe.docx», la extensión la fija el tipo
  name = name
    .replace(/[^\p{L}\p{N} _-]+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
    .trim()
  if (!name) name = fallback
  if (segmentProblem(name) || segmentProblem(`${name}.x`))
    throw new OutputPathError('name', 'Ese nombre de archivo no es válido en Windows (p. ej. «CON» o «NUL»). Usa otro.')
  return name
}

/** `subcarpeta` relativa → segmentos validados. Vacío/ausente = la carpeta de la tarea. */
export function parseSubfolder(raw: unknown): string[] {
  if (raw === undefined || raw === null || raw === '') return []
  if (typeof raw !== 'string') throw new OutputPathError('subfolder', 'La subcarpeta debe ser un texto.')
  if (raw.length > 300) throw new OutputPathError('subfolder', 'La subcarpeta es demasiado larga.')
  // Ruta absoluta, de unidad, UNC o con «~»: el agente no elige una carpeta, solo una subcarpeta de la suya.
  if (/^[\\/]/.test(raw) || /^[A-Za-z]:/.test(raw) || raw.startsWith('~')) {
    throw new OutputPathError('subfolder', 'La subcarpeta tiene que ser relativa a la carpeta de la tarea.')
  }
  const segs: string[] = []
  for (const seg of raw.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue
    if (segmentProblem(seg)) throw new OutputPathError('subfolder', 'La subcarpeta tiene caracteres o un nombre que no se admiten.')
    segs.push(seg)
  }
  if (segs.length > MAX_SUBFOLDERS) throw new OutputPathError('subfolder', `La subcarpeta admite como mucho ${MAX_SUBFOLDERS} niveles.`)
  return segs
}

export function isInside(root: string, child: string): boolean {
  return child === root || child.startsWith(root.endsWith(sep) ? root : root + sep)
}

export interface WrittenFile {
  /** Ruta absoluta en el equipo (la que ve main). */
  abs: string
  /** Ruta relativa a la carpeta de la tarea, con `/`. */
  rel: string
  bytes: number
}

export interface WriteRequest {
  name: unknown
  ext: string
  subfolder?: unknown
  bytes: Buffer
  maxBytes: number
}

/** Escribe un archivo NUEVO dentro de `root` (nunca pisa uno existente). Lanza `OutputPathError` con un texto que se le puede mostrar al agente. */
export async function writeNewFile(root: string, req: WriteRequest): Promise<WrittenFile> {
  if (req.bytes.length > req.maxBytes) throw new OutputPathError('size', 'El documento es demasiado grande.')
  const name = cleanName(req.name)
  const segs = parseSubfolder(req.subfolder)
  let rootReal: string
  try {
    rootReal = await realpath(root)
  } catch {
    throw new OutputPathError('io', 'No se encuentra la carpeta de la tarea.')
  }
  // Camino por la subcarpeta: nada de enlaces (ni a archivos ni a carpetas) y todo lo que se crea cuelga de la carpeta concedida.
  let cur = rootReal
  for (const seg of segs) {
    const next = join(cur, seg)
    let st: Awaited<ReturnType<typeof lstat>> | null = null
    try {
      st = await lstat(next)
    } catch {
      st = null
    }
    if (st) {
      if (st.isSymbolicLink() || !st.isDirectory()) throw new OutputPathError('subfolder', 'La subcarpeta no es una carpeta normal.')
    } else {
      try {
        await mkdir(next)
      } catch {
        throw new OutputPathError('io', 'No se pudo crear la subcarpeta.')
      }
    }
    cur = next
  }
  let dirReal: string
  try {
    dirReal = await realpath(cur)
  } catch {
    throw new OutputPathError('io', 'No se pudo comprobar la subcarpeta.')
  }
  if (!isInside(rootReal, dirReal)) throw new OutputPathError('outside', 'El destino queda fuera de la carpeta de la tarea.')

  // Escritura segura (1.8.18, corrección tras la revisión 1; `safe-write.ts`): la carpeta de la tarea la controla la tarea y, entre la
  // comprobación del camino y la apertura, un proceso suyo podía cambiar una carpeta por un enlace. Ahora el contenido se escribe en un
  // temporal de nombre al azar verificado DESPUÉS de abrir (mismas carpetas, mismo archivo) y se publica con `link` (sin pisar nada).
  const outsideErr = (): OutputPathError => new OutputPathError('outside', 'El destino cambió mientras se escribía; no se guardó.')
  let tmp: SafeTempFile
  try {
    tmp = SafeTempFile.create(rootReal, dirReal, { create: false, mode: 0o644 })
  } catch (err) {
    if (err instanceof LinkRefusedError) throw outsideErr()
    throw new OutputPathError('io', 'No se pudo crear el archivo en la carpeta de la tarea.')
  }
  try {
    try {
      tmp.writeAll(req.bytes)
    } catch {
      throw new OutputPathError('io', 'No se pudo escribir el archivo (¿falta espacio?).')
    }
    for (let n = 1; n <= MAX_SUFFIX; n++) {
      const file = n === 1 ? `${name}.${req.ext}` : `${name} (${n}).${req.ext}`
      let out: string | null
      try {
        out = tmp.commit(file)
      } catch (err) {
        if (err instanceof LinkRefusedError) throw outsideErr()
        throw new OutputPathError('io', 'No se pudo crear el archivo en la carpeta de la tarea.')
      }
      if (!out) continue
      const rel = [...segs, file].join('/')
      return { abs: join(dirReal, file), rel, bytes: req.bytes.length }
    }
  } finally {
    tmp.discard()
  }
  throw new OutputPathError('exists', `Ya hay ${MAX_SUFFIX} archivos con ese nombre; usa otro.`)
}
