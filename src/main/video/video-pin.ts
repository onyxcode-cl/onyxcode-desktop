/** F8-B333: raíz de confianza de las piezas opcionales. Sin red, rutas ni versiones implícitas. */
import type { RuntimePinAsset, RuntimePinEntry } from '../runtimes/runtime-pin'

export const VIDEO_BINARY_IDS = ['chrome', 'ffmpeg', 'ffprobe'] as const
export type VideoBinaryId = (typeof VIDEO_BINARY_IDS)[number]
export type VideoPlatform = 'darwin-arm64' | 'win32-x64'
export interface VideoPin {
  schema: 1
  fetchedAt: string
  chrome: RuntimePinEntry
  ffmpeg: RuntimePinEntry
  ffprobe: RuntimePinEntry
  hyperframes: {
    version: string
    gsap: string
    packageSha256: string
    lockSha256: string
    downloadBytes: Record<VideoPlatform, number>
    unpackedMax: number
    maxEntries: number
  }
}

const hex = /^[a-f0-9]{64}$/
const rel = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!\/)[A-Za-z0-9_./-]+$/
const positive = (n: unknown, max: number): n is number => Number.isSafeInteger(n) && Number(n) > 0 && Number(n) <= max

export function videoHosts(id: VideoBinaryId, key: VideoPlatform): readonly string[] {
  if (id === 'chrome') return ['storage.googleapis.com']
  return key === 'darwin-arm64'
    ? ['ffmpeg.martin-riedl.de']
    : ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
}

function validAsset(id: VideoBinaryId, key: string, v: unknown, version: string): v is RuntimePinAsset {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const a = v as RuntimePinAsset
  if (Object.keys(a).some((k) => !['url', 'format', 'size', 'sha256', 'strip', 'into', 'bin', 'unpackedMax', 'maxEntries'].includes(k)))
    return false
  const mac = key === 'darwin-arm64'
  const expected =
    id === 'chrome'
      ? `https://storage.googleapis.com/chrome-for-testing-public/${version}/${mac ? 'mac-arm64' : 'win64'}/chrome-headless-shell-${mac ? 'mac-arm64' : 'win64'}.zip`
      : mac
        ? `https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_${version}/${id}.zip`
        : `https://github.com/GyanD/codexffmpeg/releases/download/${version}/ffmpeg-${version}-essentials_build.zip`
  return (
    a.url === expected &&
    a.format === 'zip' &&
    positive(a.size, 500_000_000) &&
    hex.test(a.sha256) &&
    Number.isInteger(a.strip) &&
    a.strip >= 0 &&
    a.strip <= 1 &&
    a.into === '' &&
    typeof a.bin === 'string' &&
    rel.test(a.bin) &&
    positive(a.unpackedMax, 2_000_000_000) &&
    positive(a.maxEntries, 10_000)
  )
}

function parsePin(raw: unknown): VideoPin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const p = raw as VideoPin
  if (Object.keys(p).some((k) => !['schema', 'fetchedAt', 'chrome', 'ffmpeg', 'ffprobe', 'hyperframes'].includes(k))) return null
  if (p.schema !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(p.fetchedAt)) return null
  for (const id of VIDEO_BINARY_IDS) {
    const e = p[id]
    if (typeof e !== 'object' || Array.isArray(e)) return null
    if (!e || e.version !== (id === 'chrome' ? '158.0.8127.36' : '9.0.2') || !e.license || !e.source?.startsWith('https://') || !e.assets)
      return null
    if (Object.keys(e).some((k) => !['version', 'channel', 'releasedAt', 'license', 'source', 'assets'].includes(k))) return null
    if (
      typeof e.channel !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(e.releasedAt) ||
      typeof e.license !== 'string' ||
      typeof e.assets !== 'object' ||
      Array.isArray(e.assets)
    )
      return null
    const keys = Object.keys(e.assets).sort()
    if (keys.join() !== (id === 'ffprobe' ? 'darwin-arm64' : 'darwin-arm64,win32-x64')) return null
    for (const key of keys) if (!validAsset(id, key, e.assets[key], e.version)) return null
  }
  const h = p.hyperframes
  if (typeof h !== 'object' || Array.isArray(h)) return null
  if (
    !h ||
    h.version !== '0.9.64' ||
    h.gsap !== '3.15.0' ||
    !hex.test(h.packageSha256) ||
    !hex.test(h.lockSha256) ||
    !positive(h.downloadBytes?.['darwin-arm64'], 500_000_000) ||
    !positive(h.downloadBytes?.['win32-x64'], 500_000_000) ||
    !positive(h.unpackedMax, 1_000_000_000) ||
    !positive(h.maxEntries, 100_000)
  )
    return null
  if (
    Object.keys(h).some(
      (k) => !['version', 'gsap', 'packageSha256', 'lockSha256', 'downloadBytes', 'unpackedMax', 'maxEntries'].includes(k)
    )
  )
    return null
  if (Object.keys(h.downloadBytes).sort().join() !== 'darwin-arm64,win32-x64') return null
  return p
}

export function parseVideoPin(raw: unknown): VideoPin | null {
  try {
    return parsePin(raw)
  } catch {
    return null
  }
}

export function videoPlatform(platform = process.platform, arch: string = process.arch): VideoPlatform | null {
  const key = `${platform}-${arch}`
  return key === 'darwin-arm64' || key === 'win32-x64' ? key : null
}
