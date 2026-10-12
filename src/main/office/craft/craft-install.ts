/**
 * PRUEBA (rama `exp/craft-office-pruebas`): instalación bajo demanda de `deckcraft-cli`, con el mismo rigor que LibreOffice/cloudflared.
 * El pin (`resources/craft/pin.json`, dentro del código firmado de la app) fija URL de GitHub Releases, TAMAÑO EXACTO, SHA-256 y el
 * equipo de Apple que debe firmar el binario (Developer ID «Learning Machines LLC», DJ6XS33FX8). Nada se ejecuta sin verificar:
 * descarga (https, ≤5 saltos, tope de bytes) → SHA-256 → descomprimir en carpeta temporal → `codesign --verify --strict` + equipo →
 * renombrado atómico dentro de `userData/bin`. Solo macOS por ahora (no hay CLI para Windows en esa versión).
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, statfsSync, writeFileSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { OfficeError, downloadVerified, parseTeamId, realRun, type FetchLike, type RunFile } from '../libreoffice'

export interface CraftPinAsset {
  url: string
  size: number
  sha256: string
  /** Ruta del binario dentro del zip. */
  bin: string
  signature: { teamId: string; authority: string }
}
export interface CraftPin {
  version: string
  assets: Record<string, CraftPinAsset>
}
export type CraftStatus =
  | { state: 'unsupported'; reason: string }
  | { state: 'missing'; version: string; sizeBytes: number }
  | { state: 'installed'; version: string; bin: string }

export interface CraftDeps {
  /** `userData/bin`. */
  binDir: string
  pin: CraftPin | null
  platform?: string
  arch?: string
  fetch?: FetchLike
  run?: RunFile
  freeBytes?: () => number
}

const PREFIX = 'https://github.com/storytold/deckcraft/releases/download/'

export function parseCraftPin(raw: unknown): CraftPin | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { version?: unknown; assets?: unknown }
  if (typeof o.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(o.version) || !o.assets || typeof o.assets !== 'object') return null
  const assets: Record<string, CraftPinAsset> = {}
  for (const [k, v] of Object.entries(o.assets as Record<string, unknown>)) {
    const a = v as Partial<CraftPinAsset> | null
    if (
      !a ||
      typeof a.url !== 'string' ||
      !a.url.startsWith(PREFIX) ||
      !Number.isInteger(a.size) ||
      (a.size as number) <= 0 ||
      typeof a.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(a.sha256) ||
      typeof a.bin !== 'string' ||
      !a.bin ||
      a.bin.includes('..') ||
      a.bin.startsWith('/') ||
      !a.signature ||
      !/^[A-Z0-9]{10}$/.test(a.signature.teamId ?? '')
    )
      return null
    assets[k] = a as CraftPinAsset
  }
  return { version: o.version, assets }
}

export function loadCraftPin(path: string): CraftPin | null {
  try {
    return parseCraftPin(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

const assetFor = (d: CraftDeps): CraftPinAsset | null => {
  if ((d.platform ?? process.platform) !== 'darwin') return null
  return d.pin?.assets[`darwin-${(d.arch ?? process.arch) === 'arm64' ? 'arm64' : 'x64'}`] ?? null
}

const dirFor = (d: CraftDeps): string | null => (d.pin ? join(d.binDir, `craft-${d.pin.version}`) : null)

export function craftStatus(d: CraftDeps): CraftStatus {
  if ((d.platform ?? process.platform) !== 'darwin') return { state: 'unsupported', reason: 'Solo disponible en macOS por ahora' }
  const asset = assetFor(d)
  const dir = dirFor(d)
  if (!asset || !dir || !d.pin) return { state: 'unsupported', reason: 'No hay descarga fijada para esta plataforma' }
  const bin = join(dir, normalize(asset.bin))
  if (existsSync(join(dir, 'installed.json')) && existsSync(bin)) return { state: 'installed', version: d.pin.version, bin }
  return { state: 'missing', version: d.pin.version, sizeBytes: asset.size }
}

async function verifyBinary(run: RunFile, bin: string, teamId: string): Promise<void> {
  const v = await run('/usr/bin/codesign', ['--verify', '--strict', bin])
  if (v.code !== 0) throw new OfficeError('signature', `La firma no es válida: ${v.stderr.trim().slice(0, 200)}`)
  const out = await run('/usr/bin/codesign', ['-dvv', bin])
  const team = parseTeamId(`${out.stdout}\n${out.stderr}`)
  if (team !== teamId) throw new OfficeError('signature', `Firmada por un equipo distinto al esperado (${team ?? 'ninguno'})`)
}

/** Instala (o reutiliza) `deckcraft-cli`. Devuelve la ruta del binario. */
export async function installCraft(
  d: CraftDeps,
  onProgress: (p: { phase: 'download' | 'verify' | 'copy' | 'done'; done?: number; total?: number }) => void = () => undefined,
  signal?: AbortSignal
): Promise<string> {
  const st = craftStatus(d)
  if (st.state === 'unsupported') throw new OfficeError('unsupported', st.reason)
  if (st.state === 'installed') return st.bin
  const asset = assetFor(d)!
  const final = dirFor(d)!
  const run = d.run ?? realRun
  const fetchFn = d.fetch ?? ((u, i) => fetch(u, i))
  mkdirSync(d.binDir, { recursive: true, mode: 0o700 })
  const free = d.freeBytes ? d.freeBytes() : statfsSync(d.binDir).bavail * statfsSync(d.binDir).bsize
  if (free < asset.size * 4)
    throw new OfficeError('disk', `Espacio insuficiente: hacen falta unos ${Math.ceil((asset.size * 4) / 1e6)} MB libres`)
  const work = mkdtempSync(join(d.binDir, '.craft-tmp-'))
  const zip = join(work, 'craft.zip')
  const stage = join(work, 'stage')
  try {
    await downloadVerified(fetchFn, asset.url, zip, asset, (done) => onProgress({ phase: 'download', done, total: asset.size }), signal)
    onProgress({ phase: 'copy' })
    mkdirSync(stage, { mode: 0o700 })
    const x = await run('/usr/bin/ditto', ['-x', '-k', zip, stage])
    if (x.code !== 0) throw new OfficeError('copy', `No se pudo descomprimir: ${x.stderr.trim().slice(0, 200)}`)
    const bin = join(stage, normalize(asset.bin))
    if (!normalize(bin).startsWith(stage + sep) || !existsSync(bin) || !statSync(bin).isFile())
      throw new OfficeError('copy', 'El archivo descargado no contiene el programa esperado')
    onProgress({ phase: 'verify' })
    await verifyBinary(run, bin, asset.signature.teamId)
    rmSync(final, { recursive: true, force: true })
    renameSync(stage, final)
    writeFileSync(
      join(final, 'installed.json'),
      JSON.stringify({ version: d.pin!.version, sha256: asset.sha256, installedAt: new Date().toISOString() })
    )
    onProgress({ phase: 'done' })
    return join(final, normalize(asset.bin))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

export function removeCraft(d: CraftDeps): void {
  const dir = dirFor(d)
  if (dir && existsSync(dir) && statSync(dir).isDirectory()) rmSync(dir, { recursive: true, force: true })
}
