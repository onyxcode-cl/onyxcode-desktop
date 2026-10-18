/**
 * Pin de los runtimes (Node.js y uv) que la app descarga para los conectores locales (F8-B195). Es la raíz de confianza de la
 * descarga: `parseRuntimePin` es ESTRICTO y devuelve `null` ante cualquier desvío (ningún campo se corrige ni se rellena).
 * Puro: sin red ni disco. El archivo es `resources/runtimes/pin.json` (dentro del código firmado de la app).
 *
 * Cada activo fija URL exacta (host y ruta de la release oficial), formato, tamaño EXACTO y SHA-256. Ningún activo sin huella es válido.
 */

export type RuntimeId = 'node' | 'uv'
export const RUNTIME_IDS: readonly RuntimeId[] = ['node', 'uv']

export interface RuntimePinAsset {
  url: string
  format: 'tar.gz' | 'zip'
  /** Bytes exactos del archivo descargado. */
  size: number
  /** SHA-256 del archivo descargado (hex, minúsculas). */
  sha256: string
  /** Carpetas de primer nivel que se quitan al extraer (los archivos de Node traen `node-v…/`). */
  strip: number
  /** Subcarpeta del runtime donde se deja lo extraído (`''` = la raíz, `bin` para uv). */
  into: string
  /** Ejecutable, relativo a la carpeta del runtime. */
  bin: string
  /** Solo Node: script de `npm`, relativo a la carpeta del runtime. */
  npmCli?: string
  /** Tope de bytes descomprimidos y de entradas del archivo (defensa contra bombas de descompresión). */
  unpackedMax: number
  maxEntries: number
}

export interface RuntimePinEntry {
  version: string
  channel: string
  releasedAt: string
  license: string
  /** Página con las sumas oficiales (`SHASUMS256.txt` de nodejs.org / la release de GitHub). */
  source: string
  assets: Record<string, RuntimePinAsset>
}

export interface RuntimePin {
  fetchedAt: string
  node: RuntimePinEntry
  uv: RuntimePinEntry
}

const HEX64 = /^[0-9a-f]{64}$/
const DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/
const PLATFORM_KEY_RE = /^(darwin|win32)-(arm64|x64)$/
/** Ruta relativa segura: sin «..», sin barra inicial, sin letra de unidad, sin barras invertidas. */
const REL_RE = /^(?!.*(?:^|\/)\.\.(?:\/|$))(?![A-Za-z]:)(?!\/)[A-Za-z0-9._\-/]+$/

const posInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max

/** Prefijo de URL permitido por runtime (host y ruta de la release oficial), con la versión fijada. */
export function urlPrefix(id: RuntimeId, version: string): string {
  return id === 'node' ? `https://nodejs.org/dist/v${version}/` : `https://github.com/astral-sh/uv/releases/download/${version}/`
}

/** Hosts a los que se admite una descarga (y cada redirección) de este runtime. */
export function downloadHosts(id: RuntimeId): readonly string[] {
  return id === 'node' ? ['nodejs.org'] : ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
}

function parseAsset(id: RuntimeId, version: string, raw: unknown): RuntimePinAsset | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const a = raw as Record<string, unknown>
  const { url, format, size, sha256, strip, into, bin, npmCli, unpackedMax, maxEntries } = a
  if (typeof url !== 'string' || !url.startsWith(urlPrefix(id, version))) return null
  const name = url.slice(urlPrefix(id, version).length)
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return null
  if (format !== 'tar.gz' && format !== 'zip') return null
  if (!name.endsWith(format === 'zip' ? '.zip' : '.tar.gz')) return null
  if (!posInt(size, 500_000_000)) return null
  if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return null
  if (typeof strip !== 'number' || !Number.isInteger(strip) || strip < 0 || strip > 2) return null
  if (typeof into !== 'string' || (into !== '' && !REL_RE.test(into))) return null
  if (typeof bin !== 'string' || !REL_RE.test(bin)) return null
  if (id === 'node') {
    if (typeof npmCli !== 'string' || !REL_RE.test(npmCli)) return null
  } else if (npmCli !== undefined) return null
  if (!posInt(unpackedMax, 2_000_000_000) || !posInt(maxEntries, 100_000)) return null
  return {
    url,
    format,
    size,
    sha256,
    strip,
    into,
    bin,
    ...(typeof npmCli === 'string' ? { npmCli } : {}),
    unpackedMax,
    maxEntries
  }
}

function parseEntry(id: RuntimeId, raw: unknown): RuntimePinEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const e = raw as Record<string, unknown>
  if (typeof e.version !== 'string' || !VERSION_RE.test(e.version)) return null
  if (typeof e.channel !== 'string' || !e.channel || e.channel.length > 40) return null
  if (typeof e.releasedAt !== 'string' || !DATE_RE.test(e.releasedAt)) return null
  if (typeof e.license !== 'string' || !e.license || e.license.length > 60) return null
  if (typeof e.source !== 'string' || !e.source.startsWith('https://')) return null
  if (!e.assets || typeof e.assets !== 'object' || Array.isArray(e.assets)) return null
  const assets: Record<string, RuntimePinAsset> = {}
  for (const [key, v] of Object.entries(e.assets as Record<string, unknown>)) {
    if (!PLATFORM_KEY_RE.test(key)) return null
    const a = parseAsset(id, e.version, v)
    if (!a) return null
    assets[key] = a
  }
  if (Object.keys(assets).length === 0) return null
  return { version: e.version, channel: e.channel, releasedAt: e.releasedAt, license: e.license, source: e.source, assets }
}

export function parseRuntimePin(raw: unknown): RuntimePin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (o.schema !== 1) return null
  if (typeof o.fetchedAt !== 'string' || !DATE_RE.test(o.fetchedAt)) return null
  const node = parseEntry('node', o.node)
  const uv = parseEntry('uv', o.uv)
  if (!node || !uv) return null
  return { fetchedAt: o.fetchedAt, node, uv }
}

export function platformKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`
}

/** Activo de un runtime para esta plataforma, o `null` si el pin no trae ninguno (no se ofrece). */
export function assetFor(pin: RuntimePin | null, id: RuntimeId, platform?: string, arch?: string): RuntimePinAsset | null {
  return pin?.[id].assets[platformKey(platform, arch)] ?? null
}
