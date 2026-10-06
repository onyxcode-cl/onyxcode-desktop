/**
 * Codificador PURO del formato de carga LZPK1 (F8-B81, tanda A3). Es lo que viaja por la stdin de
 * `wsl.exe ... lazunox-install` hacia el instalador de la distro (`resources/wsl/rootfs/lazunox-install`, Python).
 *
 *   "LZPK1\n" | u32 BE: longitud del manifiesto | manifiesto JSON (UTF-8, sin espacios) | cuerpos concatenados
 *
 * Manifiesto: `{"v":1,"files":[{"path","size","sha256","mode","kind"}]}`, siempre en ese orden de claves y con los
 * archivos ordenados por ruta: la salida es determinista y `payloadSha` (sha256 del manifiesto) identifica la carga.
 * Lista cerrada de rutas: `^[a-z0-9_-]+\.py$` y `bin/opencode`; `launcher.py` y `bin/opencode` son obligatorias.
 * `bin/opencode` viaja como `opencode-tgz` (el `.tar.gz` oficial tal cual; el instalador extrae SOLO el miembro
 * regular `opencode`). Los límites son los mismos que aplica el instalador. Sin Electron ni `fs`.
 */
import { createHash } from 'node:crypto'

export const LZPK_MAGIC = 'LZPK1\n'
export const LZPK_VERSION = 1
export const LZPK_MAX_MANIFEST = 64 * 1024
/** Tope del total de cuerpos (512 MiB). */
export const LZPK_MAX_TOTAL = 512 * 1024 * 1024
export const LZPK_MAX_FILES = 16
export const LZPK_MODE_FILE = 0o644
export const LZPK_MODE_EXEC = 0o755
export const LZPK_PATH_RE = /^(?:[a-z0-9_-]+\.py|bin\/opencode)$/
export const LZPK_OPENCODE_PATH = 'bin/opencode'
export const LZPK_LAUNCHER_PATH = 'launcher.py'
export type LzpkKind = 'file' | 'opencode-tgz'

export interface LzpkInputFile {
  path: string
  data: Uint8Array
}
export interface LzpkManifestFile {
  path: string
  size: number
  sha256: string
  mode: number
  kind: LzpkKind
}
export interface LzpkManifest {
  v: typeof LZPK_VERSION
  files: LzpkManifestFile[]
}
export interface LzpkResult {
  /** Carga completa lista para escribir en la stdin del instalador. */
  buffer: Buffer
  manifest: LzpkManifest
  /** sha256 hex del manifiesto: es lo que `launcher.py --probe` devuelve como `payloadSha`. */
  payloadSha: string
}

export class LzpkError extends Error {
  constructor(
    readonly reason: 'bad-path' | 'duplicate' | 'missing' | 'too-large' | 'empty' | 'too-many',
    message?: string
  ) {
    super(message ?? reason)
    this.name = 'LzpkError'
  }
}

export const sha256Hex = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

/** `launcher.py` ejecutable (se lanza con `--exec`), `bin/opencode` ejecutable y el resto de `.py` solo lectura. */
function modeFor(path: string): number {
  return path === LZPK_LAUNCHER_PATH || path === LZPK_OPENCODE_PATH ? LZPK_MODE_EXEC : LZPK_MODE_FILE
}

export function buildManifest(files: readonly LzpkInputFile[]): LzpkManifest {
  if (files.length > LZPK_MAX_FILES) throw new LzpkError('too-many')
  const seen = new Set<string>()
  let total = 0
  const out: LzpkManifestFile[] = []
  for (const f of files) {
    if (!LZPK_PATH_RE.test(f.path)) throw new LzpkError('bad-path', f.path)
    if (seen.has(f.path)) throw new LzpkError('duplicate', f.path)
    seen.add(f.path)
    if (f.data.byteLength === 0) throw new LzpkError('empty', f.path)
    total += f.data.byteLength
    if (total > LZPK_MAX_TOTAL) throw new LzpkError('too-large')
    out.push({
      path: f.path,
      size: f.data.byteLength,
      sha256: sha256Hex(f.data),
      mode: modeFor(f.path),
      kind: f.path === LZPK_OPENCODE_PATH ? 'opencode-tgz' : 'file'
    })
  }
  for (const req of [LZPK_LAUNCHER_PATH, LZPK_OPENCODE_PATH]) if (!seen.has(req)) throw new LzpkError('missing', req)
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { v: LZPK_VERSION, files: out }
}

export function encodeLzpk(files: readonly LzpkInputFile[]): LzpkResult {
  const manifest = buildManifest(files)
  const mBytes = Buffer.from(
    JSON.stringify({
      v: manifest.v,
      files: manifest.files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, mode: f.mode, kind: f.kind }))
    }),
    'utf8'
  )
  if (mBytes.length > LZPK_MAX_MANIFEST) throw new LzpkError('too-large', 'manifest')
  const len = Buffer.alloc(4)
  len.writeUInt32BE(mBytes.length, 0)
  const byPath = new Map(files.map((f) => [f.path, f.data]))
  const bodies = manifest.files.map((f) => Buffer.from(byPath.get(f.path)!))
  return {
    buffer: Buffer.concat([Buffer.from(LZPK_MAGIC, 'latin1'), len, mBytes, ...bodies]),
    manifest,
    payloadSha: sha256Hex(mBytes)
  }
}
