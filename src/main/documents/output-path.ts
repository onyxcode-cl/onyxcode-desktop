/**
 * Ruta de salida de la herramienta `documentos`: el agente NUNCA elige dónde se escribe. Solo puede pedir un nombre y, a lo sumo,
 * una subcarpeta RELATIVA dentro de la carpeta de su tarea (la que la atadura del token le concede). Aquí se valida todo eso y se
 * escribe el archivo sin pisar nada: `O_EXCL` + `O_NOFOLLOW`, sufijo « (2)» si el nombre existe, sin enlaces en el camino y con
 * una segunda comprobación del destino real al terminar. Solo builtins de Node (y `segmentProblem`, que ya usan WSL y los visores).
 */
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, rm } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { segmentProblem } from '@shared/wsl-paths'

export const MAX_SUBFOLDERS = 4
export const MAX_NAME_LENGTH = 80
const MAX_SUFFIX = 20
const O_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0

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
  if (segmentProblem(name) || segmentProblem(`${name}.x`)) throw new OutputPathError('name', 'Ese nombre de archivo no es válido en Windows (p. ej. «CON» o «NUL»). Usa otro.')
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

function isInside(root: string, child: string): boolean {
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

  for (let n = 1; n <= MAX_SUFFIX; n++) {
    const file = n === 1 ? `${name}.${req.ext}` : `${name} (${n}).${req.ext}`
    const abs = join(dirReal, file)
    let fh
    try {
      fh = await open(abs, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o644)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw new OutputPathError('io', 'No se pudo crear el archivo en la carpeta de la tarea.')
    }
    try {
      await fh.writeFile(req.bytes)
    } catch {
      await fh.close().catch(() => undefined)
      await rm(abs, { force: true }).catch(() => undefined)
      throw new OutputPathError('io', 'No se pudo escribir el archivo (¿falta espacio?).')
    }
    await fh.close()
    // Segunda comprobación con el destino real: si algo cambió el camino mientras tanto, se deshace.
    try {
      const real = await realpath(abs)
      if (!isInside(rootReal, real)) throw new Error('outside')
    } catch {
      await rm(abs, { force: true }).catch(() => undefined)
      throw new OutputPathError('outside', 'El destino cambió mientras se escribía; no se guardó.')
    }
    const rel = [...segs, file].join('/')
    return { abs, rel, bytes: req.bytes.length }
  }
  throw new OutputPathError('exists', `Ya hay ${MAX_SUFFIX} archivos con ese nombre; usa otro.`)
}
