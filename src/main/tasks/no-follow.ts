/**
 * Escrituras y lecturas del proceso principal en zonas que una tarea CONTROLA (su carpeta privada `userData/tasks-sandbox/<clave>` y
 * su carpeta de trabajo) SIN seguir enlaces simbólicos (1.8.18).
 *
 * Desde dentro del encierro una tarea puede crear enlaces en esas zonas (`cache/opencode/models.json` → un archivo del usuario,
 * `.lazunox/memoria.md` → `~/.ssh/id_rsa`…). El proceso principal corre FUERA del encierro: si escribe o lee siguiendo ese enlace, hace
 * por la tarea lo que el encierro le niega. Regla: cada tramo se comprueba con `lstat` (carpeta real, no enlace), la ruta real final
 * tiene que ser la esperada, y el archivo final se abre con `O_NOFOLLOW` (un enlace en el último tramo falla con ELOOP). Si hay un
 * enlace, o se borra EL ENLACE (nunca su destino) y se recrea, o se falla; jamás se escribe a través de él.
 *
 * Límite conocido: entre la comprobación de las carpetas intermedias y la apertura queda una ventana mínima; solo la aprovecharía un
 * proceso de la tarea vivo en ese instante, y la carpeta privada y la de la tarea ya no se pueden borrar ni renombrar desde dentro.
 * Módulo puro (solo `node:*`).
 */
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync
} from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

const flag = (name: 'O_NOFOLLOW' | 'O_NONBLOCK' | 'O_DIRECTORY'): number => {
  const v = (constants as Record<string, number | undefined>)[name]
  return typeof v === 'number' ? v : 0
}
const O_NOFOLLOW = flag('O_NOFOLLOW')
const O_NONBLOCK = flag('O_NONBLOCK')
const O_DIRECTORY = flag('O_DIRECTORY')

export type LinkRefusedReason = 'link' | 'not-dir' | 'not-file' | 'outside'

/** Se encontró un enlace (u otra cosa que no es lo esperado) donde el proceso principal iba a escribir o leer. */
export class LinkRefusedError extends Error {
  readonly code = 'LZX_LINK_REFUSED'
  constructor(
    readonly path: string,
    readonly reason: LinkRefusedReason
  ) {
    super(`${reason}: ${path}`)
    this.name = 'LinkRefusedError'
  }
}

const errno = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code

/**
 * El sistema negó escribir o crear aquí por permisos o por ser de solo lectura (EACCES, EPERM, EROFS). Carpetas de solo lectura,
 * unidades de red o imágenes montadas: no es un enlace ni un fallo de la app.
 */
export function isWriteDenied(e: unknown): boolean {
  const c = errno(e)
  return c === 'EACCES' || c === 'EPERM' || c === 'EROFS'
}

function lstatOrNull(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p)
  } catch (e) {
    if (errno(e) === 'ENOENT') return null
    throw e
  }
}

/** Tramos de `target` bajo `base` (ambas absolutas). Lanza `outside` si `target` no cuelga de `base` (o es `base`). */
function segmentsUnder(base: string, target: string): string[] {
  const rel = relative(base, target)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new LinkRefusedError(target, 'outside')
  return rel.split(sep).filter(Boolean)
}

export interface RealDirOptions {
  /** Crear los tramos que falten (`mkdir` de uno en uno, nunca `recursive`). */
  create?: boolean
  /** Modo de las carpetas que se creen. */
  mode?: number
  /**
   * Solo zonas de la app (carpeta privada): un tramo que sea un enlace u otra cosa que no es carpeta se BORRA (`unlink`: el enlace, no
   * su destino) y se crea la carpeta. Sin esto (carpeta del usuario), se lanza `LinkRefusedError` y no se toca nada.
   */
  replace?: boolean
  /** Se llama con cada ruta reemplazada (para el registro). */
  onReplaced?: (path: string) => void
}

/**
 * Asegura que `target` es una carpeta REAL bajo `base`, sin enlaces en ningún tramo. `base` es de confianza: se ancla con su ruta real.
 * Al final la ruta real de `target` tiene que ser exactamente la ruta real de `base` + los tramos. Devuelve esa ruta.
 */
export function ensureRealDir(base: string, target: string, opts: RealDirOptions = {}): string {
  const anchor = realpathSync(base)
  const segs = segmentsUnder(base, target)
  let cur = anchor
  for (const seg of segs) {
    const next = join(cur, seg)
    let st = lstatOrNull(next)
    if (st && (st.isSymbolicLink() || !st.isDirectory())) {
      if (!opts.replace) throw new LinkRefusedError(next, st.isSymbolicLink() ? 'link' : 'not-dir')
      unlinkSync(next) // el enlace (o el archivo suelto) en sí; `unlink` nunca sigue enlaces ni borra carpetas
      opts.onReplaced?.(next)
      st = null
    }
    if (!st) {
      if (!opts.create) throw new LinkRefusedError(next, 'not-dir')
      try {
        mkdirSync(next, opts.mode === undefined ? undefined : { mode: opts.mode })
      } catch (e) {
        if (errno(e) !== 'EEXIST') throw e
      }
      const again = lstatSync(next)
      if (again.isSymbolicLink() || !again.isDirectory()) throw new LinkRefusedError(next, again.isSymbolicLink() ? 'link' : 'not-dir')
    }
    cur = next
  }
  if (realpathSync(cur) !== cur) throw new LinkRefusedError(target, 'outside')
  return cur
}

/** true si `p` existe como carpeta real (no enlace). */
export function isRealDir(p: string): boolean {
  const st = lstatOrNull(p)
  return !!st && st.isDirectory() && !st.isSymbolicLink()
}

/** Cambia el modo de una carpeta SIN seguir enlaces (`open` con `O_NOFOLLOW|O_DIRECTORY` + `fchmod`). */
export function chmodDirNoFollow(dir: string, mode: number): void {
  const fd = openSync(dir, constants.O_RDONLY | O_NOFOLLOW | O_DIRECTORY)
  try {
    if (!fstatSync(fd).isDirectory()) throw new LinkRefusedError(dir, 'not-dir')
    fchmodSync(fd, mode)
  } finally {
    closeSync(fd)
  }
}

export interface WriteNoFollowOptions {
  /** Modo final del archivo (se fija con `fchmod`, sin depender de la umask ni seguir enlaces). */
  mode?: number
  /**
   * Solo zonas de la app: si el destino es un enlace, otra cosa que no es un archivo normal, o un archivo con varios enlaces duros, se
   * borra ESE nombre (`unlink`) y se crea un archivo nuevo. Sin esto se lanza `LinkRefusedError`.
   */
  replace?: boolean
  /** No sobrescribir: si ya existe, EEXIST. */
  exclusive?: boolean
}

/** Escribe `data` en `file` sin seguir un enlace en el último tramo (las carpetas las comprueba antes quien llama, con `ensureRealDir`). */
export function writeFileNoFollow(file: string, data: string | Buffer, opts: WriteNoFollowOptions = {}): void {
  const st = lstatOrNull(file)
  let exclusive = opts.exclusive === true
  if (st && (st.isSymbolicLink() || !st.isFile() || st.nlink > 1)) {
    if (!opts.replace) throw new LinkRefusedError(file, st.isSymbolicLink() ? 'link' : 'not-file')
    unlinkSync(file)
    exclusive = true // recién borrado: si alguien vuelve a poner algo en ese nombre, se falla en vez de seguirlo
  }
  let fd: number
  try {
    fd = openSync(
      file,
      constants.O_WRONLY | constants.O_CREAT | O_NOFOLLOW | O_NONBLOCK | (exclusive ? constants.O_EXCL : constants.O_TRUNC),
      opts.mode ?? 0o644
    )
  } catch (e) {
    if (errno(e) === 'ELOOP') throw new LinkRefusedError(file, 'link')
    throw e
  }
  try {
    const fst = fstatSync(fd)
    if (!fst.isFile() || fst.nlink > 1) throw new LinkRefusedError(file, 'not-file')
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    let off = 0
    while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
    if (opts.mode !== undefined) fchmodSync(fd, opts.mode)
  } finally {
    closeSync(fd)
  }
}

/**
 * Lee `file` sin seguir un enlace en el último tramo. Devuelve null si no existe, si es un enlace o si no es un archivo normal (nunca
 * lee el destino de un enlace). `maxBytes`: si el archivo es más grande, null.
 */
export function readFileNoFollow(file: string, maxBytes = Number.MAX_SAFE_INTEGER): { content: Buffer; mtimeMs: number } | null {
  let fd: number
  try {
    fd = openSync(file, constants.O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
  } catch {
    return null
  }
  try {
    const st = fstatSync(fd)
    if (!st.isFile() || st.size > maxBytes) return null
    const buf = Buffer.alloc(st.size)
    let off = 0
    while (off < buf.length) {
      const n = readSync(fd, buf, off, buf.length - off, off)
      if (n === 0) break
      off += n
    }
    return { content: buf.subarray(0, off), mtimeMs: st.mtimeMs }
  } finally {
    closeSync(fd)
  }
}
