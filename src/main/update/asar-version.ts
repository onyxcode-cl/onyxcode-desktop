/**
 * Lee el `package.json` de la raíz de un `app.asar` en JS puro (sin Electron ni el paquete `asar`), solo desde la cabecera.
 * Formato: [u32=4][u32 tamaño del pickle de cabecera][u32 tamaño del pickle JSON][u32 longitud del JSON][JSON…][datos…];
 * el contenido de cada fichero empieza en 8 + tamaño de la cabecera + `offset`. Sustituye a `plutil` para comprobar que la
 * versión de la app descargada es la del manifiesto firmado.
 */
import type { ByteSource } from './zip-index'

const MAX_HEADER_BYTES = 32 * 1024 * 1024
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024

export type AsarErrorCode = 'format' | 'missing' | 'unsupported' | 'invalid'

export class AsarVersionError extends Error {
  constructor(
    readonly code: AsarErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AsarVersionError'
  }
}

export interface AsarPackageInfo {
  name: string
  version: string
}

const own = (o: object, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? (o as Record<string, unknown>)[k] : undefined)
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Nombre y versión del package.json de la raíz del asar. Lanza AsarVersionError si falta o la cabecera no es válida. */
export async function readAsarPackageInfo(src: ByteSource): Promise<AsarPackageInfo> {
  if (src.size < 16) throw new AsarVersionError('format', 'asar demasiado corto')
  const head = await src.read(0, 16)
  if (head.readUInt32LE(0) !== 4) throw new AsarVersionError('format', 'cabecera asar no válida')
  const headerSize = head.readUInt32LE(4)
  const jsonLen = head.readUInt32LE(12)
  if (headerSize > MAX_HEADER_BYTES || 8 + headerSize > src.size) throw new AsarVersionError('format', 'cabecera asar fuera de rango')
  if (jsonLen === 0 || 16 + jsonLen > 8 + headerSize || head.readUInt32LE(8) < 4 + jsonLen)
    throw new AsarVersionError('format', 'cabecera JSON del asar no válida')
  let header: unknown
  try {
    header = JSON.parse((await src.read(16, jsonLen)).toString('utf8'))
  } catch {
    throw new AsarVersionError('format', 'la cabecera del asar no es JSON')
  }
  const files = isObj(header) ? own(header, 'files') : undefined
  const entry = isObj(files) ? own(files, 'package.json') : undefined
  if (!isObj(entry)) throw new AsarVersionError('missing', 'el asar no tiene package.json en la raíz')
  if (entry.unpacked === true || isObj(entry.files) || entry.link !== undefined)
    throw new AsarVersionError('unsupported', 'package.json fuera del asar o no es un fichero')
  const { size, offset } = entry
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > MAX_PACKAGE_JSON_BYTES)
    throw new AsarVersionError('format', 'tamaño de package.json no válido')
  if (typeof offset !== 'string' || !/^\d{1,15}$/.test(offset)) throw new AsarVersionError('format', 'offset de package.json no válido')
  const start = 8 + headerSize + Number(offset)
  if (start + size > src.size) throw new AsarVersionError('format', 'package.json fuera del asar')
  let pkg: unknown
  try {
    pkg = JSON.parse((await src.read(start, size)).toString('utf8'))
  } catch {
    throw new AsarVersionError('invalid', 'package.json no es JSON')
  }
  if (!isObj(pkg) || typeof pkg.name !== 'string' || typeof pkg.version !== 'string')
    throw new AsarVersionError('invalid', 'package.json sin name o version')
  return { name: pkg.name, version: pkg.version }
}

export type AsarVersionCheck = { ok: true; version: string } | { ok: false; reason: string }

/** `name === 'lazunox'` y `version === expectedVersion`. Nunca lanza: devuelve el motivo. */
export async function verifyAsarVersion(src: ByteSource, expectedVersion: string, expectedName = 'lazunox'): Promise<AsarVersionCheck> {
  try {
    const info = await readAsarPackageInfo(src)
    if (info.name !== expectedName) return { ok: false, reason: `nombre «${info.name.slice(0, 40)}» distinto de ${expectedName}` }
    if (info.version !== expectedVersion)
      return { ok: false, reason: `versión «${info.version.slice(0, 40)}» distinta de ${expectedVersion}` }
    return { ok: true, version: info.version }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) }
  }
}
