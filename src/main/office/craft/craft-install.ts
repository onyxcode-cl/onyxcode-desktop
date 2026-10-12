/**
 * PRUEBA (rama `exp/craft-office-pruebas`): instalación bajo demanda de `deckcraft-cli` (PowerPoint) y `wordcraft-cli` (Word), con el
 * mismo rigor que LibreOffice/cloudflared. El pin (`resources/craft/pin.json`, dentro del código firmado de la app) fija, por programa,
 * URL de GitHub Releases, TAMAÑO EXACTO, SHA-256 y el equipo de Apple que debe firmar el binario (Developer ID «Learning Machines LLC»,
 * DJ6XS33FX8). Nada se ejecuta sin verificar: descarga (https, ≤5 saltos, tope de bytes) → SHA-256 → descomprimir en carpeta temporal
 * → `codesign --verify --strict` + equipo → renombrado atómico dentro de `userData/bin/craft-<versión>/`. Se instalan los dos juntos
 * (un solo botón); si uno ya estaba, solo se baja el que falta. Solo macOS por ahora (no hay CLI para Windows en esa versión).
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
  /** Programas a instalar, en orden (`deckcraft`, `wordcraft`), con sus descargas por plataforma. */
  tools: Record<string, Record<string, CraftPinAsset>>
}
export type CraftStatus =
  | { state: 'unsupported'; reason: string }
  | { state: 'missing'; version: string; sizeBytes: number }
  | { state: 'installed'; version: string; bin: string; bins: Record<string, string> }

export type CraftProgress = { phase: 'download' | 'verify' | 'copy' | 'done'; done?: number; total?: number }

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

const PREFIX = /^https:\/\/github\.com\/storytold\/(deckcraft|wordcraft)\/releases\/download\//
const TOOL_RE = /^[a-z]+$/

export function parseCraftPin(raw: unknown): CraftPin | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { version?: unknown; tools?: unknown }
  if (typeof o.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(o.version) || !o.tools || typeof o.tools !== 'object') return null
  const tools: CraftPin['tools'] = {}
  for (const [name, t] of Object.entries(o.tools as Record<string, unknown>)) {
    const assetsRaw = (t as { assets?: unknown } | null)?.assets
    if (!TOOL_RE.test(name) || !assetsRaw || typeof assetsRaw !== 'object') return null
    const assets: Record<string, CraftPinAsset> = {}
    for (const [k, v] of Object.entries(assetsRaw as Record<string, unknown>)) {
      const a = v as Partial<CraftPinAsset> | null
      if (
        !a ||
        typeof a.url !== 'string' ||
        !PREFIX.test(a.url) ||
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
    tools[name] = assets
  }
  return Object.keys(tools).length > 0 ? { version: o.version, tools } : null
}

export function loadCraftPin(path: string): CraftPin | null {
  try {
    return parseCraftPin(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

const platformKey = (d: CraftDeps): string => `darwin-${(d.arch ?? process.arch) === 'arm64' ? 'arm64' : 'x64'}`
const assetOf = (d: CraftDeps, tool: string): CraftPinAsset | null => d.pin?.tools[tool]?.[platformKey(d)] ?? null
const dirFor = (d: CraftDeps): string | null => (d.pin ? join(d.binDir, `craft-${d.pin.version}`) : null)
const markerOf = (dir: string, tool: string): string => join(dir, `installed-${tool}.json`)

function binOf(d: CraftDeps, tool: string): string | null {
  const dir = dirFor(d)
  const asset = assetOf(d, tool)
  if (!dir || !asset) return null
  const bin = join(dir, normalize(asset.bin))
  // Marca propia del programa; la de la primera versión de la prueba (`installed.json`) valía solo para deckcraft.
  const marked = existsSync(markerOf(dir, tool)) || (tool === 'deckcraft' && existsSync(join(dir, 'installed.json')))
  return marked && existsSync(bin) ? bin : null
}

export function craftStatus(d: CraftDeps): CraftStatus {
  if ((d.platform ?? process.platform) !== 'darwin') return { state: 'unsupported', reason: 'Solo disponible en macOS por ahora' }
  if (!d.pin || Object.keys(d.pin.tools).some((t) => !assetOf(d, t)))
    return { state: 'unsupported', reason: 'No hay descarga fijada para esta plataforma' }
  const bins: Record<string, string> = {}
  let missing = 0
  for (const t of Object.keys(d.pin.tools)) {
    const b = binOf(d, t)
    if (b) bins[t] = b
    else missing += assetOf(d, t)!.size
  }
  if (missing > 0) return { state: 'missing', version: d.pin.version, sizeBytes: missing }
  return { state: 'installed', version: d.pin.version, bin: bins.deckcraft ?? Object.values(bins)[0], bins }
}

async function verifyBinary(run: RunFile, bin: string, teamId: string): Promise<void> {
  const v = await run('/usr/bin/codesign', ['--verify', '--strict', bin])
  if (v.code !== 0) throw new OfficeError('signature', `La firma no es válida: ${v.stderr.trim().slice(0, 200)}`)
  const out = await run('/usr/bin/codesign', ['-dvv', bin])
  const team = parseTeamId(`${out.stdout}\n${out.stderr}`)
  if (team !== teamId) throw new OfficeError('signature', `Firmada por un equipo distinto al esperado (${team ?? 'ninguno'})`)
}

/** Instala (o reutiliza) los programas. Devuelve las rutas de los binarios por programa. */
export async function installCraft(
  d: CraftDeps,
  onProgress: (p: CraftProgress) => void = () => undefined,
  signal?: AbortSignal
): Promise<Record<string, string>> {
  const st = craftStatus(d)
  if (st.state === 'unsupported') throw new OfficeError('unsupported', st.reason)
  if (st.state === 'installed') return st.bins
  const final = dirFor(d)!
  const run = d.run ?? realRun
  const fetchFn = d.fetch ?? ((u, i) => fetch(u, i))
  const todo = Object.keys(d.pin!.tools).filter((t) => !binOf(d, t))
  const total = todo.reduce((n, t) => n + assetOf(d, t)!.size, 0)
  mkdirSync(d.binDir, { recursive: true, mode: 0o700 })
  const free = d.freeBytes ? d.freeBytes() : statfsSync(d.binDir).bavail * statfsSync(d.binDir).bsize
  if (free < total * 4) throw new OfficeError('disk', `Espacio insuficiente: hacen falta unos ${Math.ceil((total * 4) / 1e6)} MB libres`)
  mkdirSync(final, { recursive: true, mode: 0o700 })
  let before = 0
  for (const tool of todo) {
    const asset = assetOf(d, tool)!
    const work = mkdtempSync(join(d.binDir, '.craft-tmp-'))
    const zip = join(work, 'craft.zip')
    const stage = join(work, 'stage')
    try {
      await downloadVerified(
        fetchFn,
        asset.url,
        zip,
        asset,
        (done) => onProgress({ phase: 'download', done: before + done, total }),
        signal
      )
      onProgress({ phase: 'copy', done: before + asset.size, total })
      mkdirSync(stage, { mode: 0o700 })
      const x = await run('/usr/bin/ditto', ['-x', '-k', zip, stage])
      if (x.code !== 0) throw new OfficeError('copy', `No se pudo descomprimir: ${x.stderr.trim().slice(0, 200)}`)
      const bin = join(stage, normalize(asset.bin))
      if (!normalize(bin).startsWith(stage + sep) || !existsSync(bin) || !statSync(bin).isFile())
        throw new OfficeError('copy', 'El archivo descargado no contiene el programa esperado')
      onProgress({ phase: 'verify', done: before + asset.size, total })
      await verifyBinary(run, bin, asset.signature.teamId)
      // Cada zip trae UNA carpeta de primer nivel: se mueve entera al destino (renombrado atómico en el mismo disco).
      const top = normalize(asset.bin).split(sep)[0]
      rmSync(join(final, top), { recursive: true, force: true })
      renameSync(join(stage, top), join(final, top))
      writeFileSync(
        markerOf(final, tool),
        JSON.stringify({ version: d.pin!.version, sha256: asset.sha256, installedAt: new Date().toISOString() })
      )
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
    before += asset.size
  }
  onProgress({ phase: 'done', done: total, total })
  return (craftStatus(d) as Extract<CraftStatus, { state: 'installed' }>).bins
}

export function removeCraft(d: CraftDeps): void {
  const dir = dirFor(d)
  if (dir && existsSync(dir) && statSync(dir).isDirectory()) rmSync(dir, { recursive: true, force: true })
}
