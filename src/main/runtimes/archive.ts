/**
 * Extracción SEGURA de los archivos de los runtimes (`.tar.gz` y `.zip`), en JS puro (sin `tar`, `ditto` ni `tar.exe`): cada entrada se
 * valida ANTES de escribir nada. Lo que se rechaza (siempre falla cerrado, con `ArchiveError`):
 *  - rutas absolutas, con `..`, con letra de unidad, con `\`, con NUL o (zip) con `:` (flujos de datos alternativos de NTFS);
 *  - enlaces duros, dispositivos, FIFOs y cualquier tipo de entrada que no sea archivo, carpeta o enlace simbólico;
 *  - enlaces simbólicos que apunten fuera de la carpeta de destino (o con destino absoluto), y escribir DENTRO de un enlace creado antes;
 *  - más entradas o más bytes descomprimidos de los que fija el pin (bomba de descompresión), y archivos truncados o con suma de
 *    control de cabecera mala.
 * Los permisos se normalizan (0755 si el original era ejecutable, 0644 si no; nunca setuid/setgid ni escritura de grupo/otros).
 * Escribe SOLO dentro de `dest` (una carpeta nueva y vacía que crea quien llama); nunca sobrescribe un archivo (`wx`).
 */
import { createReadStream } from 'node:fs'
import { lstat, mkdir, open, readFile, symlink } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { createGunzip } from 'node:zlib'
import JSZip from 'jszip'

export type ArchiveErrorCode = 'unsafe-path' | 'unsafe-link' | 'unsupported-entry' | 'too-big' | 'too-many' | 'corrupt' | 'aborted'

export class ArchiveError extends Error {
  constructor(
    readonly code: ArchiveErrorCode,
    readonly detail = ''
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

export interface ExtractLimits {
  /** Carpetas de primer nivel que se quitan. */
  strip: number
  /** Subcarpeta de `dest` donde queda todo (`''` = la raíz). */
  into: string
  unpackedMax: number
  maxEntries: number
}

export interface ExtractResult {
  files: number
  bytes: number
}

/** Ruta de una entrada → segmentos limpios (sin `.` ni vacíos). Lanza si la ruta no es segura. */
export function safeSegments(raw: string, kind: 'tar' | 'zip'): string[] {
  if (raw.includes('\0') || raw.includes('\\') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw))
    throw new ArchiveError('unsafe-path', raw.slice(0, 80))
  const segs = raw.split('/').filter((s) => s !== '' && s !== '.')
  for (const s of segs) {
    if (s === '..') throw new ArchiveError('unsafe-path', raw.slice(0, 80))
    if (kind === 'zip' && s.includes(':')) throw new ArchiveError('unsafe-path', raw.slice(0, 80))
  }
  return segs
}

/** Lee `n` bytes exactos de un flujo asíncrono de trozos. */
class ByteReader {
  private chunks: Buffer[] = []
  private have = 0
  private done = false
  private readonly it: AsyncIterator<Buffer>
  constructor(source: AsyncIterable<Buffer>) {
    this.it = source[Symbol.asyncIterator]()
  }
  private async fill(n: number): Promise<void> {
    while (this.have < n && !this.done) {
      const r = await this.it.next()
      if (r.done) this.done = true
      else {
        this.chunks.push(r.value)
        this.have += r.value.length
      }
    }
  }
  /** `null` si ya no hay nada (fin limpio); lanza si el flujo se corta a mitad de los `n` bytes. */
  async read(n: number): Promise<Buffer | null> {
    await this.fill(n)
    if (this.have === 0) return null
    if (this.have < n) throw new ArchiveError('corrupt', 'archivo truncado')
    const all = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks)
    const out = all.subarray(0, n)
    const rest = all.subarray(n)
    this.chunks = rest.length ? [rest] : []
    this.have = rest.length
    return out
  }
  async skip(n: number): Promise<void> {
    let left = n
    while (left > 0) {
      const b = await this.read(Math.min(left, 1 << 20))
      if (!b) throw new ArchiveError('corrupt', 'archivo truncado')
      left -= b.length
    }
  }
}

const octal = (b: Buffer, off: number, len: number): number => {
  if (b[off]! & 0x80) throw new ArchiveError('unsupported-entry', 'tamaño en base 256')
  const s = b
    .subarray(off, off + len)
    .toString('latin1')
    .replace(/\0.*$/s, '')
    .trim()
  if (s === '') return 0
  if (!/^[0-7]+$/.test(s)) throw new ArchiveError('corrupt', 'número de cabecera')
  return parseInt(s, 8)
}
const cstr = (b: Buffer, off: number, len: number): string => {
  const slice = b.subarray(off, off + len)
  const z = slice.indexOf(0)
  return (z >= 0 ? slice.subarray(0, z) : slice).toString('utf8')
}

function parsePax(buf: Buffer): Record<string, string> {
  const out: Record<string, string> = {}
  let i = 0
  while (i < buf.length) {
    const sp = buf.indexOf(0x20, i)
    if (sp < 0) break
    const len = parseInt(buf.subarray(i, sp).toString('latin1'), 10)
    if (!Number.isInteger(len) || len <= sp - i + 1 || i + len > buf.length) throw new ArchiveError('corrupt', 'cabecera pax')
    const rec = buf.subarray(sp + 1, i + len - 1).toString('utf8')
    const eq = rec.indexOf('=')
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1)
    i += len
  }
  return out
}

/**
 * Estado compartido de la extracción: cuenta, límites y los enlaces ya creados (para no escribir a través de ellos).
 */
class Sink {
  files = 0
  bytes = 0
  entries = 0
  private readonly links = new Set<string>()
  private readonly dirs = new Set<string>()
  constructor(
    readonly dest: string,
    readonly limits: ExtractLimits,
    readonly signal?: AbortSignal
  ) {}

  tick(): void {
    if (this.signal?.aborted) throw new ArchiveError('aborted')
    if (++this.entries > this.limits.maxEntries) throw new ArchiveError('too-many')
  }
  /** Comprueba, ANTES de descomprimir, que el tamaño declarado de una entrada cabe en lo que queda del presupuesto. */
  checkBudget(declared: number): void {
    if (this.bytes + declared > this.limits.unpackedMax) throw new ArchiveError('too-big')
  }
  addBytes(n: number): void {
    this.bytes += n
    if (this.bytes > this.limits.unpackedMax) throw new ArchiveError('too-big')
  }

  /** Ruta relativa a `dest` de una entrada (con `strip` e `into`); `null` si la entrada es solo una carpeta de primer nivel a quitar. */
  rel(raw: string, kind: 'tar' | 'zip'): string[] | null {
    const segs = safeSegments(raw, kind)
    if (segs.length <= this.limits.strip) return null
    const kept = segs.slice(this.limits.strip)
    const into = this.limits.into ? this.limits.into.split('/').filter(Boolean) : []
    return [...into, ...kept]
  }

  private checkAncestors(rel: string[]): void {
    for (let i = 1; i < rel.length; i++)
      if (this.links.has(rel.slice(0, i).join('/'))) throw new ArchiveError('unsafe-link', 'escritura a través de un enlace')
  }

  async mkdirp(rel: string[]): Promise<void> {
    this.checkAncestors(rel)
    const key = rel.join('/')
    if (this.links.has(key)) throw new ArchiveError('unsafe-link', 'carpeta sobre un enlace')
    if (this.dirs.has(key)) return
    await mkdir(join(this.dest, ...rel), { recursive: true, mode: 0o755 })
    for (let i = 1; i <= rel.length; i++) this.dirs.add(rel.slice(0, i).join('/'))
  }

  async openFile(rel: string[], exec: boolean): Promise<import('node:fs/promises').FileHandle> {
    this.checkAncestors(rel)
    if (rel.length === 0) throw new ArchiveError('unsafe-path', 'archivo sin nombre')
    await this.mkdirp(rel.slice(0, -1))
    this.files++
    return open(join(this.dest, ...rel), 'wx', exec ? 0o755 : 0o644)
  }

  async link(rel: string[], target: string): Promise<void> {
    this.checkAncestors(rel)
    if (target === '' || target.includes('\0') || target.includes('\\') || target.startsWith('/') || /^[A-Za-z]:/.test(target))
      throw new ArchiveError('unsafe-link', target.slice(0, 80))
    const resolved = posix.normalize(posix.join(posix.dirname(rel.join('/')), target))
    if (resolved === '..' || resolved.startsWith('../') || posix.isAbsolute(resolved))
      throw new ArchiveError('unsafe-link', target.slice(0, 80))
    await this.mkdirp(rel.slice(0, -1))
    await symlink(target, join(this.dest, ...rel))
    this.links.add(rel.join('/'))
  }
}

async function extractTarGz(file: string, sink: Sink): Promise<void> {
  const gunzip = createGunzip()
  const src = createReadStream(file)
  const onAbort = (): void => {
    src.destroy()
    gunzip.destroy()
  }
  sink.signal?.addEventListener('abort', onAbort, { once: true })
  src.on('error', (e) => gunzip.destroy(e))
  const reader = new ByteReader(src.pipe(gunzip) as AsyncIterable<Buffer>)
  let pax: Record<string, string> = {}
  let longName: string | null = null
  let longLink: string | null = null
  try {
    for (;;) {
      if (sink.signal?.aborted) throw new ArchiveError('aborted')
      const h = await reader.read(512)
      if (!h || h.every((x) => x === 0)) break
      // Suma de control de la cabecera (el campo se cuenta como espacios).
      let sum = 0
      for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i]!
      if (sum !== octal(h, 148, 8)) throw new ArchiveError('corrupt', 'suma de control de la cabecera')
      const type = String.fromCharCode(h[156] === 0 ? 0x30 : h[156]!)
      const size = octal(h, 124, 12)
      const padded = Math.ceil(size / 512) * 512

      if (type === 'x' || type === 'L' || type === 'K' || type === 'g') {
        if (size > 1 << 20) throw new ArchiveError('unsupported-entry', 'cabecera extendida enorme')
        const body = size > 0 ? await reader.read(size) : Buffer.alloc(0)
        if (padded > size) await reader.skip(padded - size)
        if (type === 'x') pax = { ...pax, ...parsePax(body ?? Buffer.alloc(0)) }
        else if (type === 'L') longName = cstr(body ?? Buffer.alloc(0), 0, size)
        else if (type === 'K') longLink = cstr(body ?? Buffer.alloc(0), 0, size)
        continue
      }

      const prefix = cstr(h, 345, 155)
      const baseName = cstr(h, 0, 100)
      let name = pax.path ?? longName ?? (prefix ? `${prefix}/${baseName}` : baseName)
      const linkName = pax.linkpath ?? longLink ?? cstr(h, 157, 100)
      const realSize = pax.size !== undefined ? Number(pax.size) : size
      pax = {}
      longName = null
      longLink = null
      if (!Number.isSafeInteger(realSize) || realSize < 0) throw new ArchiveError('corrupt', 'tamaño')
      sink.tick()

      if (type === '0') {
        const rel = sink.rel(name, 'tar')
        sink.addBytes(realSize)
        if (rel === null) {
          await reader.skip(Math.ceil(realSize / 512) * 512)
          continue
        }
        const fh = await sink.openFile(rel, (octal(h, 100, 8) & 0o111) !== 0)
        try {
          let left = realSize
          while (left > 0) {
            const b = await reader.read(Math.min(left, 1 << 20))
            if (!b) throw new ArchiveError('corrupt', 'archivo truncado')
            await fh.write(b)
            left -= b.length
          }
        } finally {
          await fh.close()
        }
        const pad = Math.ceil(realSize / 512) * 512 - realSize
        if (pad > 0) await reader.skip(pad)
      } else if (type === '5') {
        name = name.replace(/\/+$/, '')
        const rel = sink.rel(name, 'tar')
        if (rel && rel.length > 0) await sink.mkdirp(rel)
        if (realSize > 0) await reader.skip(Math.ceil(realSize / 512) * 512)
      } else if (type === '2') {
        const rel = sink.rel(name, 'tar')
        if (rel === null) throw new ArchiveError('unsafe-link', 'enlace en la carpeta quitada')
        await sink.link(rel, linkName)
        if (realSize > 0) await reader.skip(Math.ceil(realSize / 512) * 512)
      } else {
        // Enlaces duros («1»), dispositivos, FIFOs, etc.
        throw new ArchiveError('unsupported-entry', `tipo ${JSON.stringify(type)}`)
      }
    }
  } catch (err) {
    src.destroy()
    gunzip.destroy()
    if (err instanceof ArchiveError) throw err
    if (sink.signal?.aborted) throw new ArchiveError('aborted')
    throw new ArchiveError('corrupt', err instanceof Error ? err.message.slice(0, 120) : 'lectura')
  } finally {
    sink.signal?.removeEventListener('abort', onAbort)
  }
}

async function extractZip(file: string, sink: Sink): Promise<void> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(await readFile(file))
  } catch {
    throw new ArchiveError('corrupt', 'zip ilegible')
  }
  const names = Object.keys(zip.files)
  if (names.length > sink.limits.maxEntries) throw new ArchiveError('too-many')
  for (const name of names) {
    sink.tick()
    const entry = zip.files[name]!
    const rel = sink.rel(name, 'zip')
    const perm = entry.unixPermissions
    if (typeof perm === 'number') {
      const kind = perm & 0o170000
      if (kind === 0o120000) throw new ArchiveError('unsafe-link', name.slice(0, 80))
      if (kind !== 0 && kind !== 0o100000 && kind !== 0o040000) throw new ArchiveError('unsupported-entry', name.slice(0, 80))
    }
    if (entry.dir) {
      if (rel && rel.length > 0) await sink.mkdirp(rel)
      continue
    }
    if (rel === null) throw new ArchiveError('unsafe-path', 'archivo en la carpeta quitada')
    const declared = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (typeof declared === 'number') sink.checkBudget(declared)
    const data = await entry.async('nodebuffer')
    sink.addBytes(data.length)
    const exec = typeof perm === 'number' ? (perm & 0o111) !== 0 : /\.(exe|bat|cmd|dll)$/i.test(name)
    const fh = await sink.openFile(rel, exec)
    try {
      await fh.write(data)
    } finally {
      await fh.close()
    }
  }
}

/** Extrae `file` en `dest` (carpeta nueva). Si algo falla lanza `ArchiveError`; el contenido a medias lo borra quien llama. */
export async function extractArchive(
  file: string,
  format: 'tar.gz' | 'zip',
  dest: string,
  limits: ExtractLimits,
  signal?: AbortSignal
): Promise<ExtractResult> {
  await mkdir(dest, { recursive: true, mode: 0o700 })
  const sink = new Sink(dest, limits, signal)
  if (format === 'zip') await extractZip(file, sink)
  else await extractTarGz(file, sink)
  // Nada de lo escrito puede haber salido de `dest`: comprobación final de que el árbol existe y es una carpeta real.
  const st = await lstat(dest)
  if (!st.isDirectory() || st.isSymbolicLink()) throw new ArchiveError('corrupt', 'destino')
  return { files: sink.files, bytes: sink.bytes }
}
