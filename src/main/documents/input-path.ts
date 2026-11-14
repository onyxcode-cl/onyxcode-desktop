/**
 * Lectura segura de un archivo YA EXISTENTE de la carpeta de la tarea, para `documentos_renderizar` (el que no creó `crear`: editado con
 * un script, armado con `bash`…). Ese archivo lo pudo fabricar a mano un agente aislado, así que antes de que el main lo parsee se exige
 * lo mismo que a la salida (`output-path.ts`) y más: la carpeta sale de la atadura del token, la ruta es RELATIVA (sin `..`, sin
 * unidad, sin `~`), ningún componente del camino es un enlace, el realpath queda dentro de la carpeta, se abre con `O_NOFOLLOW`, se
 * lee del mismo descriptor (lo que se mide es lo que se copia) y se comprueba que el archivo no fue reemplazado durante la lectura.
 * Extensión en lista blanca, firma (zip para Office, `%PDF-` para pdf) y tope de tamaño. Solo builtins de Node.
 */
import { MAX_ARTIFACT_HTML_BYTES } from '@shared/slides-html'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { segmentProblem } from '@shared/wsl-paths'
import { OutputPathError } from './output-path'

export const MAX_INPUT_BYTES = 25 * 1024 * 1024
/** Una imagen que se incrusta en un documento: más que esto no entra (ni se lee entera en memoria). */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif'])
const MAX_DEPTH = 8
const O_NOFOLLOW = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
/** macOS 11+: `O_NOFOLLOW_ANY` (0x20000000) rechaza un enlace en CUALQUIER componente de la ruta, no solo en el último; Node no lo expone. Sustituye a `O_NOFOLLOW` (juntos dan EINVAL). */
const O_NOFOLLOW_ANY = process.platform === 'darwin' ? 0x20000000 : 0
const EXT_TIPO = { pptx: 'pptx', docx: 'docx', xlsx: 'xlsx', pdf: 'pdf' } as const

export type InputTipo = (typeof EXT_TIPO)[keyof typeof EXT_TIPO]
export interface TaskFile {
  abs: string
  rel: string
  tipo: InputTipo
  bytes: Buffer
}

/** Lo que se espera leer: un documento de Office/PDF (vista previa) una imagen (para incrustarla) o procedencia JSON (128 KB). La firma de la imagen la comprueba quien llama. */
export type ReadKind = 'office' | 'image' | 'provenance' | 'html'

function isInside(root: string, child: string): boolean {
  return child === root || child.startsWith(root.endsWith(sep) ? root : root + sep)
}

const bad = (message: string): OutputPathError => new OutputPathError('subfolder', message)

/**
 * `agentRoot` = cómo ve el agente la carpeta de la tarea (puede ser `/win/c/x` en Windows): una ruta absoluta que empieza por ella se
 * acepta como relativa. Cualquier otra ruta absoluta se rechaza.
 */
export function relativeInputPath(raw: unknown, agentRoots: string[] = []): string[] {
  if (typeof raw !== 'string' || raw.length === 0) throw bad('Falta la ruta del archivo.')
  if (raw.length > 400) throw bad('La ruta es demasiado larga.')
  let rel = raw
  if (/^[\\/]|^[A-Za-z]:/.test(rel) || rel.startsWith('~')) {
    const root = agentRoots
      .map((r) => r.replace(/[\\/]+$/, ''))
      .find((r) => r && (rel === r || rel.startsWith(r + '/') || rel.startsWith(r + '\\')))
    if (!root) throw bad('La ruta tiene que ser relativa a la carpeta de la tarea (o una que devolvió `crear`).')
    rel = rel.slice(root.length)
  }
  const segs: string[] = []
  for (const seg of rel.split(/[\\/]+/)) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') throw bad('La ruta no puede subir de carpeta («..»).')
    if (segmentProblem(seg)) throw bad('La ruta tiene caracteres o un nombre que no se admiten.')
    segs.push(seg)
  }
  if (segs.length === 0) throw bad('Falta el nombre del archivo.')
  if (segs.length > MAX_DEPTH) throw bad('La ruta tiene demasiados niveles.')
  return segs
}

function hasSignature(tipo: InputTipo, bytes: Buffer): boolean {
  if (tipo === 'pdf') return bytes.subarray(0, 1024).includes('%PDF-')
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** `afterWalk`/`afterOpen` solo existen para probar un cambio del camino entre la validación, la apertura y la lectura. */
export async function readTaskFile(
  root: string,
  raw: unknown,
  agentRoots: string[] = [],
  hooks: { afterWalk?: () => Promise<void>; afterOpen?: () => Promise<void> } = {},
  kind: ReadKind = 'office'
): Promise<TaskFile> {
  const segs = relativeInputPath(raw, agentRoots)
  const ext = segs[segs.length - 1].split('.').pop()?.toLowerCase() ?? ''
  const hasExt = segs[segs.length - 1].includes('.')
  const maxBytes =
    kind === 'html' ? MAX_ARTIFACT_HTML_BYTES : kind === 'provenance' ? 128 * 1024 : kind === 'image' ? MAX_IMAGE_BYTES : MAX_INPUT_BYTES
  let tipo: InputTipo | undefined
  if (kind === 'html') {
    if (!hasExt || !['html', 'htm'].includes(ext)) throw new OutputPathError('name', 'ruta: usa un archivo .html o .htm.')
    tipo = 'pdf' // marcador interno; el HTML se valida antes de preparar sus fotos
  } else if (kind === 'image') {
    if (!hasExt || !IMAGE_EXTS.has(ext)) throw new OutputPathError('name', 'Solo se admiten imágenes .png, .jpg, .webp o .gif.')
    tipo = 'pdf' // marcador interno: el tipo real lo da la firma del archivo (ver `image-files.ts`)
  } else if (kind === 'provenance') {
    if (!hasExt || ext !== 'json') throw new OutputPathError('name', 'La procedencia debe ser un archivo .json.')
    tipo = 'pdf' // solo marcador interno: la autoridad se coteja por hash con el registro de main
  } else {
    tipo = (EXT_TIPO as Record<string, InputTipo | undefined>)[hasExt ? ext : '']
    if (!tipo) throw new OutputPathError('name', 'Solo se puede renderizar un .pptx, .docx, .xlsx o .pdf.')
  }
  let rootReal: string
  try {
    rootReal = await realpath(root)
  } catch {
    throw new OutputPathError('io', 'No se encuentra la carpeta de la tarea.')
  }
  // Recorrido 1: cada componente con lstat (sin enlaces) y se guarda su identidad (dev/ino). La del ARCHIVO es la referencia: lo que se abre
  // después tiene que ser exactamente ese inodo, aunque alguien cambie un directorio intermedio por un enlace entre medias.
  const walk = async (): Promise<{ abs: string; ids: string[]; nlink: number }> => {
    let cur = rootReal
    const ids: string[] = []
    let nlink = 1
    for (let i = 0; i < segs.length; i++) {
      cur = join(cur, segs[i])
      let st
      try {
        st = await lstat(cur)
      } catch {
        throw new OutputPathError('io', 'No se encuentra ese archivo en la carpeta de la tarea.')
      }
      if (st.isSymbolicLink()) throw bad('La ruta pasa por un enlace; no se admite.')
      if (i < segs.length - 1 ? !st.isDirectory() : !st.isFile()) throw bad('La ruta no es un archivo normal de la carpeta de la tarea.')
      ids.push(`${st.dev}:${st.ino}`)
      nlink = st.nlink
    }
    try {
      if (!isInside(rootReal, await realpath(cur))) throw new Error('outside')
    } catch {
      throw new OutputPathError('outside', 'El archivo queda fuera de la carpeta de la tarea.')
    }
    return { abs: cur, ids, nlink }
  }
  const first = await walk()
  const cur = first.abs
  // Un archivo con otro nombre duro en otra carpeta no se puede distinguir por su ruta: no se admite.
  if (first.nlink > 1) throw bad('El archivo tiene varios nombres (enlace duro); no se admite.')
  await hooks.afterWalk?.()
  let fh
  try {
    fh = await open(cur, constants.O_RDONLY | (O_NOFOLLOW_ANY || O_NOFOLLOW))
  } catch {
    throw new OutputPathError('io', 'No se pudo abrir el archivo.')
  }
  try {
    const st = await fh.stat()
    if (!st.isFile() || `${st.dev}:${st.ino}` !== first.ids[first.ids.length - 1])
      throw new OutputPathError('outside', 'El archivo cambió mientras se abría.')
    if (st.size > maxBytes)
      throw new OutputPathError(
        'size',
        kind === 'html'
          ? 'El HTML supera el presupuesto de 24 MiB.'
          : kind === 'provenance'
            ? 'El JSON de procedencia es demasiado grande (máx. 128 KB).'
            : kind === 'image'
              ? 'La imagen es demasiado grande (máx. 5 MB).'
              : 'El archivo es demasiado grande para la vista previa (máx. 25 MB).'
      )
    await hooks.afterOpen?.()
    const bytes = Buffer.alloc(st.size)
    let off = 0
    while (off < st.size) {
      const { bytesRead } = await fh.read(bytes, off, st.size - off, off)
      if (bytesRead === 0) break
      off += bytesRead
    }
    const after = await fh.stat()
    if (off !== st.size || after.size !== st.size || after.mtimeMs !== st.mtimeMs)
      throw new OutputPathError('io', 'El archivo cambió mientras se leía; vuelve a intentarlo.')
    // Recorrido 2: la ruta tiene que seguir siendo la misma cadena de inodos (ni un directorio cambiado por un enlace, ni otro archivo).
    const second = await walk().catch(() => null)
    if (!second || second.ids.join('|') !== first.ids.join('|')) throw new OutputPathError('outside', 'El archivo cambió mientras se leía.')
    if (kind === 'office' && !hasSignature(tipo, bytes)) throw new OutputPathError('name', `El archivo no es un .${tipo} válido.`)
    return { abs: cur, rel: segs.join('/'), tipo, bytes }
  } finally {
    await fh.close()
  }
}
