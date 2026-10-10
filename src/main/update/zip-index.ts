/**
 * Índice de un ZIP en JS puro (sin zipinfo, tar ni dependencias): lee el EOCD (y el EOCD64 si hace falta) y el directorio central.
 * Es portable —igual en Mac y Windows— y se prueba con fixtures generados en la propia prueba. NO descomprime nada: solo da
 * los nombres, tamaños y tipo de cada entrada para validarlos (isSafeZipEntryWin) ANTES de extraer.
 */
import { rawFsPromises } from './raw-fs'

/** Fuente de bytes de acceso aleatorio (un fichero o un Buffer en las pruebas). */
export interface ByteSource {
  size: number
  read(offset: number, length: number): Promise<Buffer>
}

export function bufferSource(buf: Buffer): ByteSource {
  return {
    size: buf.length,
    read: async (offset, length) => {
      if (offset < 0 || length < 0 || offset + length > buf.length) throw new Error('lectura fuera de rango')
      return buf.subarray(offset, offset + length)
    }
  }
}

/** Abre un fichero como fuente; hay que llamar a `close()`. */
export async function fileSource(path: string): Promise<ByteSource & { close: () => Promise<void> }> {
  const fh = await rawFsPromises().open(path, 'r')
  const { size } = await fh.stat()
  return {
    size,
    read: async (offset, length) => {
      if (offset < 0 || length < 0 || offset + length > size) throw new Error('lectura fuera de rango')
      const buf = Buffer.alloc(length)
      let done = 0
      while (done < length) {
        const { bytesRead } = await fh.read(buf, done, length - done, offset + done)
        if (bytesRead === 0) throw new Error('fin de fichero inesperado')
        done += bytesRead
      }
      return buf
    },
    close: () => fh.close()
  }
}

export type ZipIndexErrorCode = 'format' | 'unsupported' | 'encrypted' | 'too-many' | 'too-big'

export class ZipIndexError extends Error {
  constructor(
    readonly code: ZipIndexErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ZipIndexError'
  }
}

export interface ZipIndexEntry {
  name: string
  compressedSize: number
  size: number
  method: number
  isDirectory: boolean
  /** Enlace simbólico (modo Unix S_IFLNK) o punto de reanálisis de Windows (atributo 0x400). */
  isSymlink: boolean
  localHeaderOffset: number
}

export interface ZipIndex {
  entries: ZipIndexEntry[]
  /** Suma de los tamaños descomprimidos declarados. */
  totalUncompressed: number
}

export interface ReadZipIndexOptions {
  /** Tope de la suma descomprimida (ZIP bomba). Sin valor, solo se exige que sea un entero seguro. */
  maxUncompressed?: number
  maxEntries?: number
}

const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_LOCATOR64 = 0x07064b50
const SIG_CEN = 0x02014b50
const EOCD_MIN = 22
const MAX_CEN_BYTES = 128 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 200_000

function big(v: bigint, what: string): number {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipIndexError('format', `${what} fuera de rango`)
  return Number(v)
}

interface Cen {
  offset: number
  size: number
  count: number
  /** Posición donde empieza el EOCD (o el EOCD64): el directorio central debe terminar antes. */
  limit: number
}

async function locateCentralDirectory(src: ByteSource): Promise<Cen> {
  if (src.size < EOCD_MIN) throw new ZipIndexError('format', 'no es un ZIP')
  const tailLen = Math.min(src.size, EOCD_MIN + 0xffff)
  const tailStart = src.size - tailLen
  const tail = await src.read(tailStart, tailLen)
  let pos = -1
  for (let i = tail.length - EOCD_MIN; i >= 0; i--) {
    if (tail.readUInt32LE(i) === SIG_EOCD && i + EOCD_MIN + tail.readUInt16LE(i + 20) === tail.length) {
      pos = i
      break
    }
  }
  if (pos < 0) throw new ZipIndexError('format', 'no se encontró el final del ZIP (EOCD)')
  const eocdAt = tailStart + pos
  const disk = tail.readUInt16LE(pos + 4)
  const cenDisk = tail.readUInt16LE(pos + 6)
  let count = tail.readUInt16LE(pos + 10)
  let size = tail.readUInt32LE(pos + 12)
  let offset = tail.readUInt32LE(pos + 16)
  if (disk !== 0 || cenDisk !== 0 || tail.readUInt16LE(pos + 8) !== count) throw new ZipIndexError('unsupported', 'ZIP de varios discos')
  let limit = eocdAt
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    // ZIP64: el localizador está justo antes del EOCD.
    if (eocdAt < 20) throw new ZipIndexError('format', 'falta el localizador ZIP64')
    const loc = await src.read(eocdAt - 20, 20)
    if (loc.readUInt32LE(0) !== SIG_LOCATOR64 || loc.readUInt32LE(4) !== 0 || loc.readUInt32LE(16) !== 1)
      throw new ZipIndexError('format', 'localizador ZIP64 no válido')
    const at = big(loc.readBigUInt64LE(8), 'EOCD64')
    if (at + 56 > eocdAt - 20) throw new ZipIndexError('format', 'EOCD64 fuera de rango')
    const e = await src.read(at, 56)
    if (e.readUInt32LE(0) !== SIG_EOCD64) throw new ZipIndexError('format', 'EOCD64 no válido')
    if (e.readUInt32LE(16) !== 0 || e.readUInt32LE(20) !== 0) throw new ZipIndexError('unsupported', 'ZIP de varios discos')
    const total = big(e.readBigUInt64LE(32), 'entradas')
    if (big(e.readBigUInt64LE(24), 'entradas') !== total) throw new ZipIndexError('unsupported', 'ZIP de varios discos')
    count = total
    size = big(e.readBigUInt64LE(40), 'directorio central')
    offset = big(e.readBigUInt64LE(48), 'directorio central')
    limit = at
  }
  if (offset + size > limit) throw new ZipIndexError('format', 'directorio central fuera de rango')
  return { offset, size, count, limit }
}

function decodeName(raw: Buffer, flags: number): string {
  return raw.toString(flags & 0x800 ? 'utf8' : 'latin1')
}

/** Lee el directorio central. Lanza ZipIndexError si el ZIP está mal formado, cifrado o pasa de los límites. */
export async function readZipIndex(src: ByteSource, opts: ReadZipIndexOptions = {}): Promise<ZipIndex> {
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES
  const maxUncompressed = opts.maxUncompressed ?? Number.MAX_SAFE_INTEGER
  const cen = await locateCentralDirectory(src)
  if (cen.count > maxEntries) throw new ZipIndexError('too-many', 'demasiadas entradas')
  if (cen.size > MAX_CEN_BYTES) throw new ZipIndexError('too-big', 'directorio central enorme')
  const buf = cen.size > 0 ? await src.read(cen.offset, cen.size) : Buffer.alloc(0)
  const entries: ZipIndexEntry[] = []
  let total = 0
  let p = 0
  for (let n = 0; n < cen.count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN)
      throw new ZipIndexError('format', 'entrada del directorio central no válida')
    const madeBy = buf.readUInt16LE(p + 4)
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    let csize = buf.readUInt32LE(p + 20)
    let usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const extAttr = buf.readUInt32LE(p + 38)
    let lho = buf.readUInt32LE(p + 42)
    const end = p + 46 + nameLen + extraLen + commentLen
    if (end > buf.length) throw new ZipIndexError('format', 'entrada del directorio central truncada')
    if (flags & 0x1) throw new ZipIndexError('encrypted', 'entrada cifrada')
    const name = decodeName(buf.subarray(p + 46, p + 46 + nameLen), flags)
    // Campo extra ZIP64 (0x0001): trae, por orden, solo los valores que valían 0xFFFFFFFF.
    const extra = buf.subarray(p + 46 + nameLen, p + 46 + nameLen + extraLen)
    for (let q = 0; q + 4 <= extra.length;) {
      const id = extra.readUInt16LE(q)
      const len = extra.readUInt16LE(q + 2)
      if (q + 4 + len > extra.length) throw new ZipIndexError('format', 'campo extra truncado')
      if (id === 0x0001) {
        let r = q + 4
        const take = (): number => {
          if (r + 8 > q + 4 + len) throw new ZipIndexError('format', 'campo ZIP64 corto')
          const v = big(extra.readBigUInt64LE(r), 'tamaño')
          r += 8
          return v
        }
        if (usize === 0xffffffff) usize = take()
        if (csize === 0xffffffff) csize = take()
        if (lho === 0xffffffff) lho = take()
      }
      q += 4 + len
    }
    if (lho + 30 > cen.offset) throw new ZipIndexError('format', 'cabecera local fuera de rango')
    total += usize
    if (!Number.isSafeInteger(total) || total > maxUncompressed) throw new ZipIndexError('too-big', 'el ZIP se expande demasiado')
    const host = madeBy >> 8
    const isSymlink = host === 3 ? ((extAttr >>> 16) & 0xf000) === 0xa000 : (host === 0 || host === 10) && (extAttr & 0x400) !== 0
    entries.push({
      name,
      compressedSize: csize,
      size: usize,
      method,
      isDirectory: name.endsWith('/'),
      isSymlink,
      localHeaderOffset: lho
    })
    p = end
  }
  if (p !== buf.length) throw new ZipIndexError('format', 'sobran bytes en el directorio central')
  return { entries, totalUncompressed: total }
}
