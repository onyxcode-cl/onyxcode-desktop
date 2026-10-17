import JSZip from 'jszip'
import type { OfficeFailReason } from '@shared/attach-office'

/** Error de extracción con el motivo que verá la persona. */
export class ExtractError extends Error {
  constructor(readonly reason: OfficeFailReason) {
    super(reason)
  }
}

const MAX_ENTRIES = 20_000
/** Una parte XML descomprimida (documento, hoja, diapositiva…) no puede pasar de esto. */
export const MAX_PART_BYTES = 30 * 1024 * 1024
/** Suma de lo que se descomprime en toda la extracción. */
const MAX_TOTAL_BYTES = 120 * 1024 * 1024

const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

/** Contenedor binario antiguo de OLE2 (.doc/.xls/.ppt y también los OOXML cifrados con contraseña). */
export function isCfb(buf: Uint8Array): boolean {
  return buf.length >= 8 && CFB_MAGIC.every((b, i) => buf[i] === b)
}

/** Un OOXML con contraseña es un contenedor OLE2 que lleva el flujo `EncryptedPackage` (nombre en UTF-16LE). */
export function cfbIsEncryptedPackage(buf: Uint8Array): boolean {
  const needle = Buffer.from('EncryptedPackage', 'utf16le')
  return Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).includes(needle)
}

export function isZip(buf: Uint8Array): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5 || buf[2] === 7)
}

interface ZipEntryInternal {
  _data?: { uncompressedSize?: number }
}

export class Zip {
  private total = 0
  constructor(private readonly zip: JSZip) {}

  has(name: string): boolean {
    return this.zip.file(name) !== null
  }

  names(): string[] {
    return Object.keys(this.zip.files).filter((n) => !this.zip.files[n].dir)
  }

  /** Texto UTF-8 de una parte, o `null` si no existe. Rechaza (documento dañado) las partes que declaran pasar de los topes. */
  async text(name: string): Promise<string | null> {
    const f = this.zip.file(name)
    if (!f) return null
    const declared = (f as unknown as ZipEntryInternal)._data?.uncompressedSize
    if (typeof declared === 'number' && declared > MAX_PART_BYTES) throw new ExtractError('corrupt')
    this.total += typeof declared === 'number' ? declared : 0
    if (this.total > MAX_TOTAL_BYTES) throw new ExtractError('corrupt')
    const s = await f.async('string')
    if (s.length > MAX_PART_BYTES) throw new ExtractError('corrupt')
    return s
  }
}

export async function openZip(buf: Uint8Array): Promise<Zip> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buf, { checkCRC32: false })
  } catch {
    throw new ExtractError('corrupt')
  }
  if (Object.keys(zip.files).length > MAX_ENTRIES) throw new ExtractError('corrupt')
  return new Zip(zip)
}
