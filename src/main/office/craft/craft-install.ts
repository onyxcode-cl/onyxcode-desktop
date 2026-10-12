/**
 * PRUEBA (rama `exp/craft-office-pruebas`): instalación bajo demanda de `deckcraft-cli` (PowerPoint), `wordcraft-cli` (Word) y
 * `gridcraft-cli` (Excel), con el mismo rigor que LibreOffice/cloudflared. El pin (`resources/craft/pin.json`, dentro del código firmado
 * de la app) fija, por programa y plataforma, URL de GitHub Releases, TAMAÑO EXACTO y SHA-256. En macOS además el equipo de Apple que
 * debe firmar el binario (Developer ID «Learning Machines LLC», DJ6XS33FX8). Nada se ejecuta sin verificar: descarga (https, ≤5 saltos,
 * tope de bytes) → SHA-256 → descomprimir en carpeta temporal (`ditto` en macOS, `tar.exe` en Windows) → en macOS `codesign --verify
 * --strict` + equipo → renombrado atómico dentro de `userData/bin/craft-<versión>/`. Se instalan todos juntos (un solo botón); si alguno
 * ya estaba, solo se baja el que falta. Plataformas: darwin-arm64, darwin-x64, win32-x64, win32-arm64.
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
  /** Solo macOS: equipo de Apple que firma el binario. En Windows la integridad la dan tamaño + SHA-256. */
  signature?: { teamId: string; authority: string }
}
export interface CraftPin {
  version: string
  /** Programas a instalar (`deckcraft`, `wordcraft`, `gridcraft`), con sus descargas por plataforma. */
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

const TOOL_RE = /^[a-z]+$/
/** `tar.exe` del propio Windows (bsdtar, Windows 10+): ruta absoluta para no ejecutar nada que esté en el directorio actual. */
const WIN_TAR = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')

export function parseCraftPin(raw: unknown): CraftPin | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { version?: unknown; tools?: unknown }
  if (typeof o.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(o.version) || !o.tools || typeof o.tools !== 'object') return null
  const tools: CraftPin['tools'] = {}
  for (const [name, t] of Object.entries(o.tools as Record<string, unknown>)) {
    const assetsRaw = (t as { assets?: unknown } | null)?.assets
    if (!TOOL_RE.test(name) || !assetsRaw || typeof assetsRaw !== 'object') return null
    const prefix = `https://github.com/storytold/${name}/releases/download/`
    const assets: Record<string, CraftPinAsset> = {}
    for (const [k, v] of Object.entries(assetsRaw as Record<string, unknown>)) {
      const a = v as Partial<CraftPinAsset> | null
      // La firma de Apple es obligatoria en macOS; en Windows es opcional (si viene, debe ser válida).
      const sig = a?.signature
      const sigOk = sig == null ? !k.startsWith('darwin-') : /^[A-Z0-9]{10}$/.test(sig.teamId ?? '')
      if (
        !a ||
        typeof a.url !== 'string' ||
        !a.url.startsWith(prefix) ||
        !Number.isInteger(a.size) ||
        (a.size as number) <= 0 ||
        typeof a.sha256 !== 'string' ||
        !/^[0-9a-f]{64}$/.test(a.sha256) ||
        typeof a.bin !== 'string' ||
        !a.bin ||
        a.bin.includes('..') ||
        a.bin.startsWith('/') ||
        a.bin.startsWith('\\') ||
        /^[A-Za-z]:/.test(a.bin) ||
        !sigOk
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

const platOf = (d: CraftDeps): string => d.platform ?? process.platform
const platformKey = (d: CraftDeps): string => `${platOf(d)}-${d.arch ?? process.arch}`
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
  if (platOf(d) !== 'darwin' && platOf(d) !== 'win32')
    return { state: 'unsupported', reason: 'Solo disponible en macOS y Windows por ahora' }
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
  const isWin = platOf(d) === 'win32'
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
      const x = isWin ? await run(WIN_TAR, ['-xf', zip, '-C', stage]) : await run('/usr/bin/ditto', ['-x', '-k', zip, stage])
      if (x.code !== 0) throw new OfficeError('copy', `No se pudo descomprimir: ${x.stderr.trim().slice(0, 200)}`)
      const bin = join(stage, normalize(asset.bin))
      if (!normalize(bin).startsWith(stage + sep) || !existsSync(bin) || !statSync(bin).isFile())
        throw new OfficeError('copy', 'El archivo descargado no contiene el programa esperado')
      onProgress({ phase: 'verify', done: before + asset.size, total })
      if (!isWin) {
        if (!asset.signature) throw new OfficeError('signature', 'Falta la firma esperada para este programa')
        await verifyBinary(run, bin, asset.signature.teamId)
      }
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
