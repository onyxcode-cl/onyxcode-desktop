/**
 * Escritura segura del proceso principal en carpetas que una tarea puede modificar (1.8.18, corrección tras la revisión 1).
 *
 * Problema: `ensureRealDir` comprueba los tramos y, un momento después, se escribía POR RUTA. Si en ese hueco un proceso de la tarea
 * cambia una carpeta intermedia por un enlace, la escritura cae en el destino del enlace (fuera del encierro). Node 24 no tiene `openat`
 * y en macOS no se puede obtener la ruta real de un descriptor, así que no se puede abrir «relativo a una carpeta ya abierta». La técnica
 * es comprobar DESPUÉS de abrir y escribir el contenido solo cuando todo cuadra:
 *
 * 1. `ensureRealDir` (carpetas reales, sin enlaces) y se anota dispositivo e inodo (`lstat`) de cada carpeta desde `base` hasta la de
 *    destino.
 * 2. Se crea un temporal de nombre AL AZAR en la carpeta de destino con `O_CREAT|O_EXCL|O_NOFOLLOW` (modo 600). Con el nombre al azar ya
 *    no hay un temporal de nombre fijo que la tarea pueda dejar preparado como enlace.
 * 3. Se comprueba: las carpetas siguen siendo las mismas (mismo dispositivo e inodo, ninguna es un enlace), el `lstat` de la ruta del
 *    temporal da el MISMO archivo que el `fstat` del descriptor abierto, y otra vez las carpetas. Si algo no cuadra, el archivo abierto
 *    no está donde se esperaba: se quita el temporal (solo si la ruta apunta a ese mismo archivo) y se falla con `LinkRefusedError`.
 *    Lo único que pudo quedar fuera es un archivo VACÍO con nombre al azar `.lzx-<hex>.tmp`: el contenido todavía no se escribió.
 * 4. Se escribe el contenido por el descriptor (va al archivo verificado aunque la ruta cambie después) y se fija el modo con `fchmod`.
 * 5. Se comprueba otra vez y se termina por ruta, con el temporal y el destino en LA MISMA carpeta:
 *    - `replace`: `rename(temporal, destino)`. Reemplaza el NOMBRE (si el destino es un enlace, se reemplaza el enlace; nunca se escribe
 *      en su destino). Con `refuseLinkTarget`, un destino que es un enlace hace fallar en vez de reemplazarlo.
 *    - sin `replace`: `link(temporal, destino)` (no sobrescribe: EEXIST si hay cualquier cosa con ese nombre, enlace incluido) y luego
 *      se quita el temporal. Si el sistema de archivos no admite enlaces duros, se abre el destino con `O_EXCL|O_NOFOLLOW`, se verifica
 *      igual que el temporal y se copia por descriptor.
 *    Si en ese último paso la carpeta se hubiera cambiado por un enlace, `rename`/`link` buscarían el temporal en el destino del enlace,
 *    donde no está: fallan con ENOENT y no se escribe nada fuera.
 * 6. Al final se comprueba que el destino es el archivo escrito, en las mismas carpetas.
 *
 * Límite conocido (sin `openat` no se puede cerrar del todo): un proceso de la tarea que cambiara una carpeta por un enlace y la devolviera
 * en el instante exacto entre dos comprobaciones seguidas (doble cambio en microsegundos) podría engañar la comprobación del paso 3. Por
 * eso las carpetas donde escribe el proceso principal en cada arranque o descarga (`.lazunox`, `.lazunox/trabajo`, `descargas`,
 * `grabaciones`, la carpeta de la tarea y la privada) además NO se pueden renombrar ni borrar desde dentro del encierro (perfil Seatbelt,
 * `deny file-write-unlink (literal …)`): ahí no hay carrera posible.
 *
 * Windows: no hay encierro Seatbelt y crear enlaces pide administrador; `O_NOFOLLOW` no existe. Allí se usa el camino anterior más el
 * nombre al azar: carpetas comprobadas con `ensureRealDir`, temporal `O_EXCL`, `rename`/`link`, SIN las comparaciones de dispositivo e
 * inodo (sin verificar en Windows: ver `docs/PARIDAD-WINDOWS.json`).
 *
 * Puntos de enganche (`hooks`): SOLO para pruebas; permiten simular el cambio de una carpeta por un enlace entre dos pasos.
 * Módulo puro (solo `node:*`).
 */
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  unlinkSync,
  write,
  writeSync,
  type Stats
} from 'node:fs'
import { open as openAsync } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { ensureRealDir, LinkRefusedError } from './no-follow'

const O_NOFOLLOW = (constants as Record<string, number | undefined>).O_NOFOLLOW ?? 0
/** Windows: sin comparaciones de dispositivo e inodo (ver cabecera). */
const CHECK_INODES = process.platform !== 'win32'
const CHUNK = 1024 * 1024

/** Solo pruebas: se llaman en los momentos intermedios para simular una carrera. */
export interface SafeWriteHooks {
  /** Después de comprobar y anotar las carpetas, antes de abrir el temporal. */
  afterDirCheck?: () => void
  /** Después de abrir y verificar el temporal, antes de escribir el contenido. */
  afterOpen?: () => void
  /** Con el contenido escrito, antes de `rename`/`link`. */
  beforeCommit?: () => void
}

export interface SafeWriteOptions {
  /** Crear las carpetas que falten bajo `base` (de una en una, comprobadas). Por defecto true. */
  create?: boolean
  /** Modo final del archivo (con `fchmod`). Por defecto 0o644. */
  mode?: number
  /** true: reemplaza lo que haya con ese nombre (`rename`). false (por defecto): no sobrescribe (EEXIST). */
  replace?: boolean
  /** Con `replace`: si el destino es un enlace simbólico, falla (`LinkRefusedError`) en vez de reemplazar el enlace. */
  refuseLinkTarget?: boolean
  /** Solo pruebas. */
  hooks?: SafeWriteHooks
}

type DirMark = { path: string; dev: number; ino: number }

const errno = (e: unknown): string | undefined => (e as NodeJS.ErrnoException | null)?.code

function lstatOrNull(p: string): Stats | null {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}

/**
 * Carpeta real de destino bajo `base` (creándola si hace falta) y la lista de carpetas desde `base` hasta ella con su dispositivo e
 * inodo. `dir` puede ser la propia `base`.
 */
function markDirs(base: string, dir: string, create: boolean): { real: string; marks: DirMark[] } {
  const anchor = realpathSync(base)
  const rel = relative(base, dir)
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw new LinkRefusedError(dir, 'outside')
  const real = rel ? ensureRealDir(base, dir, { create }) : anchor
  const marks: DirMark[] = []
  let cur = anchor
  const segs = rel ? relative(anchor, real).split(sep).filter(Boolean) : []
  for (const seg of [null, ...segs]) {
    if (seg !== null) cur = join(cur, seg)
    const st = lstatSync(cur)
    if (st.isSymbolicLink() || !st.isDirectory()) throw new LinkRefusedError(cur, st.isSymbolicLink() ? 'link' : 'not-dir')
    marks.push({ path: cur, dev: st.dev, ino: st.ino })
  }
  return { real, marks }
}

function dirsUnchanged(marks: DirMark[]): boolean {
  if (!CHECK_INODES) return true
  for (const m of marks) {
    const st = lstatOrNull(m.path)
    if (!st || st.isSymbolicLink() || !st.isDirectory() || st.dev !== m.dev || st.ino !== m.ino) return false
  }
  return true
}

function samePathFile(path: string, fst: Stats): boolean {
  if (!CHECK_INODES) return true
  const st = lstatOrNull(path)
  return !!st && st.isFile() && !st.isSymbolicLink() && st.dev === fst.dev && st.ino === fst.ino
}

function writeAllSync(fd: number, buf: Buffer): void {
  let off = 0
  while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off)
}

/** Copia `srcFd` → `dstFd` por descriptor, desde el principio. */
function copyFdSync(srcFd: number, dstFd: number): void {
  const buf = Buffer.allocUnsafe(CHUNK)
  let pos = 0
  for (;;) {
    const n = readSync(srcFd, buf, 0, buf.length, pos)
    if (n <= 0) break
    writeAllSync(dstFd, buf.subarray(0, n))
    pos += n
  }
}

/**
 * Archivo temporal verificado en una carpeta que la tarea controla. Uso: `SafeTempFile.create` → escribir (`writeAll`, `copyFrom…`) →
 * `commit` (o `discard`). Siempre `discard` en un `finally` (no hace nada si ya se confirmó).
 */
export class SafeTempFile {
  private fd: number | null
  private done = false
  private constructor(
    /** Carpeta tal como la pasó quien llama (las rutas devueltas usan esta forma). */
    private readonly givenDir: string,
    /** Carpeta real (donde se escribe). */
    readonly dir: string,
    readonly tmpPath: string,
    fd: number,
    private readonly marks: DirMark[],
    private readonly mode: number,
    private readonly hooks: SafeWriteHooks
  ) {
    this.fd = fd
  }

  /** Comprueba carpetas (creándolas si `create`), abre el temporal y verifica que está donde se espera. Lanza `LinkRefusedError` si no. */
  static create(base: string, dir: string, opts: Pick<SafeWriteOptions, 'create' | 'mode' | 'hooks'> = {}): SafeTempFile {
    const hooks = opts.hooks ?? {}
    const { real, marks } = markDirs(base, dir, opts.create !== false)
    hooks.afterDirCheck?.()
    const tmpPath = join(real, `.lzx-${randomBytes(8).toString('hex')}.tmp`)
    let fd: number
    try {
      fd = openSync(tmpPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, 0o600)
    } catch (e) {
      if (errno(e) === 'ELOOP') throw new LinkRefusedError(tmpPath, 'link')
      if (errno(e) === 'ENOENT' || errno(e) === 'ENOTDIR') throw new LinkRefusedError(real, 'not-dir')
      throw e
    }
    const tmp = new SafeTempFile(dir, real, tmpPath, fd, marks, opts.mode ?? 0o644, hooks)
    tmp.verifyAt(tmpPath)
    hooks.afterOpen?.()
    return tmp
  }

  private get openFd(): number {
    if (this.fd === null) throw new Error('SafeTempFile cerrado')
    return this.fd
  }

  /** El archivo abierto está en `path`, dentro de las mismas carpetas reales. Si no: quita el temporal y lanza. */
  private verifyAt(path: string): void {
    const fst = fstatSync(this.openFd)
    const ok = fst.isFile() && dirsUnchanged(this.marks) && samePathFile(path, fst) && dirsUnchanged(this.marks)
    if (!ok) {
      this.discard()
      throw new LinkRefusedError(this.dir, 'link')
    }
  }

  writeAll(data: string | Buffer): void {
    writeAllSync(this.openFd, typeof data === 'string' ? Buffer.from(data, 'utf8') : data)
  }

  /** Copia un archivo de CONFIANZA (fuera de las zonas de la tarea) por descriptor. */
  copyFromSync(src: string): void {
    const s = openSync(src, constants.O_RDONLY)
    try {
      copyFdSync(s, this.openFd)
    } finally {
      closeSync(s)
    }
  }

  /** Igual que `copyFromSync`, sin bloquear el proceso principal (archivos grandes: descargas). */
  async copyFrom(src: string): Promise<void> {
    const s = await openAsync(src, 'r')
    const writeFd = (buf: Buffer, off: number, len: number): Promise<number> =>
      new Promise((res, rej) => write(this.openFd, buf, off, len, null, (err, n) => (err ? rej(err) : res(n))))
    try {
      const buf = Buffer.allocUnsafe(CHUNK)
      for (;;) {
        const { bytesRead } = await s.read(buf, 0, buf.length, null)
        if (bytesRead <= 0) break
        let off = 0
        while (off < bytesRead) off += await writeFd(buf, off, bytesRead - off)
      }
    } finally {
      await s.close()
    }
  }

  /**
   * Termina con el nombre `name` en la misma carpeta. Devuelve la ruta final (con la carpeta tal como se pasó), o null si `replace` es false y el nombre ya existe (para
   * que quien llama pruebe otro). Lanza `LinkRefusedError` si algo no cuadra.
   */
  commit(name: string, opts: Pick<SafeWriteOptions, 'replace' | 'refuseLinkTarget'> = {}): string | null {
    if (!name || name !== basename(name) || name === '.' || name === '..') throw new LinkRefusedError(name, 'outside')
    const fd = this.openFd
    fchmodSync(fd, this.mode)
    this.verifyAt(this.tmpPath)
    this.hooks.beforeCommit?.()
    const final = join(this.dir, name)
    if (opts.replace) {
      if (opts.refuseLinkTarget && lstatOrNull(final)?.isSymbolicLink()) throw new LinkRefusedError(final, 'link')
      renameSync(this.tmpPath, final) // mismo directorio: si la carpeta cambió por un enlace, ENOENT (el temporal no está allí)
    } else {
      try {
        linkSync(this.tmpPath, final)
        unlinkSync(this.tmpPath)
      } catch (e) {
        const code = errno(e)
        if (code === 'EEXIST') return null
        if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EOPNOTSUPP' && code !== 'ENOSYS') throw e
        // Sin enlaces duros (FAT, exFAT, algunas unidades de red): el destino se abre exclusivo, se verifica igual y se copia.
        if (!this.copyIntoExclusive(final)) return null
      }
    }
    this.done = true
    this.closeFd()
    // El destino es el archivo escrito, en las mismas carpetas (si no, se avisa: el contenido ya no está donde se esperaba).
    if (CHECK_INODES && !dirsUnchanged(this.marks)) throw new LinkRefusedError(this.dir, 'link')
    return join(this.givenDir, name)
  }

  private copyIntoExclusive(final: string): boolean {
    let out: number
    try {
      out = openSync(final, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | O_NOFOLLOW, this.mode)
    } catch (e) {
      if (errno(e) === 'EEXIST') return false
      if (errno(e) === 'ELOOP') throw new LinkRefusedError(final, 'link')
      throw e
    }
    try {
      const fst = fstatSync(out)
      if (!(dirsUnchanged(this.marks) && samePathFile(final, fst) && dirsUnchanged(this.marks))) {
        if (samePathFile(final, fst)) unlinkSync(final)
        throw new LinkRefusedError(this.dir, 'link')
      }
      copyFdSync(this.openFd, out) // lectura posicional del temporal ya verificado (abierto en lectura y escritura)
      fchmodSync(out, this.mode)
    } finally {
      closeSync(out)
    }
    unlinkSync(this.tmpPath)
    return true
  }

  private closeFd(): void {
    if (this.fd === null) return
    try {
      closeSync(this.fd)
    } catch {
      /* ya cerrado */
    }
    this.fd = null
  }

  /** Quita el temporal (solo si la ruta apunta a ESE archivo) y cierra. No hace nada si ya se confirmó. */
  discard(): void {
    if (this.done) return
    this.done = true
    try {
      if (this.fd !== null) {
        const fst = fstatSync(this.fd)
        const st = lstatOrNull(this.tmpPath)
        if (st && st.isFile() && st.dev === fst.dev && st.ino === fst.ino) unlinkSync(this.tmpPath)
      }
    } catch {
      /* mejor esfuerzo */
    }
    this.closeFd()
  }
}

/**
 * Escribe `data` en `file` (que cuelga de `base`) con la técnica de la cabecera. Devuelve la ruta final. Sin `replace`, si ya existe
 * algo con ese nombre lanza un error con `code: 'EEXIST'`.
 */
export function safeWriteFile(base: string, file: string, data: string | Buffer, opts: SafeWriteOptions = {}): string {
  const tmp = SafeTempFile.create(base, dirname(file), opts)
  try {
    tmp.writeAll(data)
    const out = tmp.commit(basename(file), opts)
    if (!out) throw Object.assign(new Error(`EEXIST: ${file}`), { code: 'EEXIST' })
    return out
  } finally {
    tmp.discard()
  }
}

/**
 * Copia el archivo de confianza `src` a la carpeta `dir` (bajo `base`) sin sobrescribir: prueba los nombres que da `names` (en orden)
 * hasta uno libre. Sin bloquear (archivos grandes). Devuelve la ruta final, o null si ningún nombre estaba libre.
 */
export async function safeCopyIntoDir(
  base: string,
  dir: string,
  src: string,
  names: Iterable<string>,
  opts: Pick<SafeWriteOptions, 'create' | 'mode' | 'hooks'> = {}
): Promise<string | null> {
  const tmp = SafeTempFile.create(base, dir, opts)
  try {
    await tmp.copyFrom(src)
    for (const name of names) {
      const out = tmp.commit(name)
      if (out) return out
    }
    return null
  } finally {
    tmp.discard()
  }
}

/** Igual que `safeCopyIntoDir`, síncrona (archivos que elige la persona, como antes con `copyFileSync`). */
export function safeCopyIntoDirSync(
  base: string,
  dir: string,
  src: string,
  names: Iterable<string>,
  opts: Pick<SafeWriteOptions, 'create' | 'mode' | 'hooks'> = {}
): string | null {
  const tmp = SafeTempFile.create(base, dir, opts)
  try {
    tmp.copyFromSync(src)
    for (const name of names) {
      const out = tmp.commit(name)
      if (out) return out
    }
    return null
  } finally {
    tmp.discard()
  }
}

/** Escribe `data` con el primer nombre libre de `names` en `dir` (bajo `base`), sin sobrescribir. Devuelve la ruta o null. */
export function safeWriteNewFile(
  base: string,
  dir: string,
  data: string | Buffer,
  names: Iterable<string>,
  opts: Pick<SafeWriteOptions, 'create' | 'mode' | 'hooks'> = {}
): string | null {
  const tmp = SafeTempFile.create(base, dir, opts)
  try {
    tmp.writeAll(data)
    for (const name of names) {
      const out = tmp.commit(name)
      if (out) return out
    }
    return null
  } finally {
    tmp.discard()
  }
}

/** Nombres candidatos para `name`, en orden ("informe.pdf", "informe (2).pdf", …). Quien escribe usa el primero libre. */
export function* candidateNames(name: string): Generator<string> {
  yield name
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let i = 2; i < 1000; i++) yield `${stem} (${i})${ext}`
  yield `${stem}-${Date.now()}${ext}`
}
