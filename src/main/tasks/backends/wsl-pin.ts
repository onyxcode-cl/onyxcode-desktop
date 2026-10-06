/**
 * Pin de la imagen base de WSL (clave `wsl-rootfs` de `resources/opencode-bin/pin.json`, F8-B81).
 * Es la raíz de confianza de la descarga: `parseWslPin` es ESTRICTO y devuelve null ante cualquier desvío
 * (ningún campo se corrige ni se rellena). Puro: sin red ni disco.
 */

/** Repositorio dedicado de las imágenes (no es el repo de la app: el comprobador de actualizaciones no las ve). */
export const WSL_ROOTFS_REPO = 'onyxcode-cl/lazunox-wsl'
/** Versión de imagen `YYYY.M.D` (sin ceros a la izquierda en mes y día). */
export const WSL_ROOTFS_VERSION_RE = /^\d{4}\.(?:1[0-2]|[1-9])\.(?:3[01]|[12]\d|[1-9])$/
/** Tope de la imagen comprimida y de la descomprimida: valores absurdos delatan un pin corrupto. */
export const WSL_ROOTFS_MAX_SIZE = 2 * 1024 ** 3
export const WSL_ROOTFS_MAX_UNPACKED = 4 * 1024 ** 3

export interface WslPin {
  version: string
  minVersion: string
  /** Fecha de construcción `YYYY-MM-DD`. */
  builtAt: string
  url: string
  sha256: string
  size: number
  unpackedMax: number
}

export function isWslRootfsVersion(v: unknown): v is string {
  return typeof v === 'string' && WSL_ROOTFS_VERSION_RE.test(v)
}

/** Compara dos versiones `YYYY.M.D` válidas: <0, 0 o >0. Una versión inválida compara como la más antigua. */
export function compareWslRootfsVersion(a: string, b: string): number {
  const va = isWslRootfsVersion(a)
  const vb = isWslRootfsVersion(b)
  if (!va || !vb) return va === vb ? 0 : va ? 1 : -1
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let k = 0; k < 3; k++) if (pa[k] !== pb[k]) return pa[k]! - pb[k]!
  return 0
}

/** URL exacta de la release para una versión: repo dedicado, etiqueta `rootfs-<v>` y nombre `lazunox-rootfs-<v>-x64.tar.gz`. */
export function wslRootfsUrl(version: string): string {
  return `https://github.com/${WSL_ROOTFS_REPO}/releases/download/rootfs-${version}/lazunox-rootfs-${version}-x64.tar.gz`
}

const posInt = (n: unknown, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0 && n <= max

export function parseWslPin(raw: unknown): WslPin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as Record<string, unknown>
  const { version, minVersion, builtAt, url, sha256, size, unpackedMax } = p
  if (!isWslRootfsVersion(version) || !isWslRootfsVersion(minVersion)) return null
  if (compareWslRootfsVersion(minVersion, version) > 0) return null
  if (typeof builtAt !== 'string' || !/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/.test(builtAt)) return null
  if (typeof url !== 'string' || url !== wslRootfsUrl(version)) return null
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null
  if (!posInt(size, WSL_ROOTFS_MAX_SIZE) || !posInt(unpackedMax, WSL_ROOTFS_MAX_UNPACKED)) return null
  if (unpackedMax < size) return null
  return { version, minVersion, builtAt, url, sha256, size, unpackedMax }
}
