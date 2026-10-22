/**
 * Puerto del sistema de archivos (síncrono, mínimo) que usa el manager. En producción es `nodeFs`; las pruebas
 * pueden inyectar uno en memoria o con fallos.
 */
import * as nodefs from 'node:fs'

export interface ShellBgFs {
  /** Crea una carpeta temporal privada (0700) bajo `base` y devuelve su ruta. */
  mkdtemp(base: string, prefix: string): string
  mkdirp(path: string, mode: number): void
  /** Abre para añadir (crea con `mode`, sin seguir enlaces simbólicos al final). */
  openAppend(path: string, mode: number): number
  writeAll(fd: number, data: Buffer): void
  close(fd: number): void
  writeFile(path: string, data: Buffer | string, mode: number): void
  readRange(path: string, start: number, length: number): Buffer
  readText(path: string): string | null
  /** Tamaño y mtime, o `null` si no existe. */
  stat(path: string): { size: number; mtimeMs: number; isDirectory: boolean } | null
  realpath(path: string): string
  rmrf(path: string): void
  readdir(path: string): string[]
}

export const nodeFs: ShellBgFs = {
  mkdtemp: (base, prefix) => {
    nodefs.mkdirSync(base, { recursive: true, mode: 0o700 })
    // La carpeta base debe ser un directorio real (no un enlace) y nuestro: en /tmp otro usuario podría haberla puesto antes.
    const st = nodefs.lstatSync(base)
    if (!st.isDirectory() || (typeof process.getuid === 'function' && st.uid !== process.getuid())) {
      throw new Error(`unsafe base directory for background shell output: ${base}`)
    }
    if (process.platform !== 'win32') nodefs.chmodSync(base, 0o700)
    const d = nodefs.mkdtempSync(`${base}/${prefix}`)
    nodefs.chmodSync(d, 0o700)
    return d
  },
  mkdirp: (path, mode) => {
    nodefs.mkdirSync(path, { recursive: true, mode })
  },
  openAppend: (path, mode) => {
    const flags = nodefs.constants.O_WRONLY | nodefs.constants.O_CREAT | nodefs.constants.O_APPEND | (nodefs.constants.O_NOFOLLOW ?? 0)
    return nodefs.openSync(path, flags, mode)
  },
  writeAll: (fd, data) => {
    let off = 0
    while (off < data.length) off += nodefs.writeSync(fd, data, off, data.length - off)
  },
  close: (fd) => nodefs.closeSync(fd),
  writeFile: (path, data, mode) => {
    nodefs.writeFileSync(path, data, { mode })
  },
  readRange: (path, start, length) => {
    const fd = nodefs.openSync(path, 'r')
    try {
      const buf = Buffer.alloc(length)
      const n = nodefs.readSync(fd, buf, 0, length, start)
      return buf.subarray(0, n)
    } finally {
      nodefs.closeSync(fd)
    }
  },
  readText: (path) => {
    try {
      return nodefs.readFileSync(path, 'utf8')
    } catch {
      return null
    }
  },
  stat: (path) => {
    try {
      const s = nodefs.statSync(path)
      return { size: s.size, mtimeMs: s.mtimeMs, isDirectory: s.isDirectory() }
    } catch {
      return null
    }
  },
  realpath: (path) => nodefs.realpathSync(path),
  rmrf: (path) => nodefs.rmSync(path, { recursive: true, force: true }),
  readdir: (path) => {
    try {
      return nodefs.readdirSync(path)
    } catch {
      return []
    }
  }
}
