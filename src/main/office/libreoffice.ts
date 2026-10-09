/**
 * LibreOffice para las skills de oficina (Word, Excel, PowerPoint → imagen para revisar el resultado): NO viaja en el instalador
 * (~300 MB) sino que se descarga BAJO DEMANDA, con consentimiento explícito, desde la descarga oficial de The Document Foundation y con
 * verificación estricta, igual que `cloudflared`. Nada se ejecuta sin verificar.
 *
 * El pin (`resources/libreoffice/pin.json`, dentro del código firmado de la app) fija por arquitectura: la URL oficial, el TAMAÑO EXACTO
 * en bytes, el SHA-256 y la firma esperada (Developer ID de The Document Foundation, equipo `7P5S3ZLCN7`). La descarga sigue las
 * redirecciones del espejo (https y como mucho 5 saltos): dónde esté el espejo da igual porque el tamaño exacto y el SHA-256 se
 * comprueban ANTES de montar nada.
 *
 * Instalar: pin válido → espacio libre suficiente → descarga a un archivo temporal propio (tope exacto de bytes, SHA-256 en flujo) →
 * `hdiutil attach` de solo lectura sin explorar → `LibreOffice.app` con `codesign --verify --deep --strict` y equipo = pin → copia con
 * `ditto` a una carpeta nueva dentro de `userData/bin` → la copia se vuelve a verificar → renombrado atómico → se desmonta SIEMPRE.
 * Sin permisos de administrador y sin tocar `/Applications`. Si el usuario ya tiene LibreOffice en `/Applications`, se usa ese y no se descarga.
 */
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  statfsSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'

export interface OfficePinAsset {
  url: string
  size: number
  sha256: string
  signature: { teamId: string; authority: string }
}
export interface OfficePin {
  version: string
  assets: Record<string, OfficePinAsset>
}

export type OfficeErrorCode =
  'unsupported' | 'no-pin' | 'disk' | 'download' | 'size' | 'hash' | 'mount' | 'signature' | 'copy' | 'cancelled'

export class OfficeError extends Error {
  constructor(
    readonly code: OfficeErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'OfficeError'
  }
}

export type OfficeStatus =
  | { state: 'unsupported'; reason: string }
  | { state: 'missing'; version: string; sizeBytes: number }
  | { state: 'installed'; source: 'app' | 'system'; version: string; soffice: string }

export type OfficeProgress = { phase: 'download' | 'verify' | 'mount' | 'copy' | 'done'; done?: number; total?: number }

export type RunFile = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>
export type FetchLike = (url: string, init: { signal?: AbortSignal; redirect: 'manual' }) => Promise<Response>

export interface OfficeDeps {
  /** `userData/bin` (carpeta de binarios opcionales). */
  binDir: string
  pin: OfficePin | null
  platform?: string
  arch?: string
  fetch?: FetchLike
  run?: RunFile
  /** Ruta de la instalación del sistema (para pruebas). */
  systemApp?: string
  /** Bytes libres de la carpeta de `binDir` (para pruebas). */
  freeBytes?: () => number
}

const MAX_REDIRECTS = 5
const SOFFICE_REL = join('Contents', 'MacOS', 'soffice')

export const realRun: RunFile = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { timeout: 600_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code as number) : err ? -1 : 0
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })

export function parseOfficePin(raw: unknown): OfficePin | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as { version?: unknown; assets?: unknown }
  if (typeof o.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(o.version) || !o.assets || typeof o.assets !== 'object') return null
  const assets: Record<string, OfficePinAsset> = {}
  for (const [k, v] of Object.entries(o.assets as Record<string, unknown>)) {
    const a = v as Partial<OfficePinAsset> | null
    if (
      !a ||
      typeof a.url !== 'string' ||
      !a.url.startsWith('https://download.documentfoundation.org/') ||
      !Number.isInteger(a.size) ||
      (a.size as number) <= 0 ||
      typeof a.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(a.sha256) ||
      !a.signature ||
      !/^[A-Z0-9]{10}$/.test(a.signature.teamId ?? '')
    ) {
      return null
    }
    assets[k] = a as OfficePinAsset
  }
  return { version: o.version, assets }
}

export function loadOfficePin(path: string): OfficePin | null {
  try {
    return parseOfficePin(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

function assetFor(deps: OfficeDeps): OfficePinAsset | null {
  const platform = deps.platform ?? process.platform
  const arch = deps.arch ?? process.arch
  if (platform !== 'darwin') return null
  return deps.pin?.assets[`darwin-${arch === 'arm64' ? 'arm64' : 'x64'}`] ?? null
}

/** Carpeta de la copia administrada por la app (`<binDir>/libreoffice-<versión>/LibreOffice.app`). */
export function managedApp(deps: OfficeDeps): string | null {
  return deps.pin ? join(deps.binDir, `libreoffice-${deps.pin.version}`, 'LibreOffice.app') : null
}

export function officeStatus(deps: OfficeDeps): OfficeStatus {
  if ((deps.platform ?? process.platform) !== 'darwin') return { state: 'unsupported', reason: 'Solo macOS por ahora' }
  const managed = managedApp(deps)
  if (managed && existsSync(join(managed, SOFFICE_REL))) {
    return { state: 'installed', source: 'app', version: deps.pin!.version, soffice: join(managed, SOFFICE_REL) }
  }
  const system = deps.systemApp ?? '/Applications/LibreOffice.app'
  if (existsSync(join(system, SOFFICE_REL))) {
    return { state: 'installed', source: 'system', version: 'sistema', soffice: join(system, SOFFICE_REL) }
  }
  const asset = assetFor(deps)
  if (!asset) return { state: 'unsupported', reason: 'Sin descarga fijada para esta arquitectura' }
  return { state: 'missing', version: deps.pin!.version, sizeBytes: asset.size }
}

/** Descarga `url` a `dest` con tope EXACTO de bytes y SHA-256 en flujo. Lanza `OfficeError`. */
export async function downloadVerified(
  fetchFn: FetchLike,
  url: string,
  dest: string,
  expect: { size: number; sha256: string },
  onProgress: (done: number) => void,
  signal?: AbortSignal
): Promise<void> {
  let current = url
  let res: Response | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!current.startsWith('https://')) throw new OfficeError('download', 'La descarga debe ser por https')
    res = await fetchFn(current, { signal, redirect: 'manual' }).catch((e: unknown) => {
      if (signal?.aborted) throw new OfficeError('cancelled', 'Descarga cancelada')
      throw new OfficeError('download', `No se pudo descargar: ${e instanceof Error ? e.message : String(e)}`)
    })
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) throw new OfficeError('download', 'Redirección sin destino')
      current = new URL(loc, current).toString()
      continue
    }
    break
  }
  if (!res || res.status !== 200 || !res.body) throw new OfficeError('download', `Respuesta inesperada (${res?.status ?? 'sin respuesta'})`)
  const declared = Number(res.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > 0 && declared !== expect.size) {
    throw new OfficeError('size', `Tamaño distinto al esperado (${declared} ≠ ${expect.size})`)
  }
  const hash = createHash('sha256')
  let received = 0
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      received += chunk.length
      if (received > expect.size) return cb(new OfficeError('size', 'La descarga supera el tamaño esperado'))
      hash.update(chunk)
      onProgress(received)
      cb(null, chunk)
    }
  })
  try {
    await pipeline(Readable.fromWeb(res.body as never), guard, createWriteStream(dest, { mode: 0o600 }), { signal })
  } catch (e) {
    rmSync(dest, { force: true })
    if (e instanceof OfficeError) throw e
    if (signal?.aborted) throw new OfficeError('cancelled', 'Descarga cancelada')
    throw new OfficeError('download', `Descarga interrumpida: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (received !== expect.size) {
    rmSync(dest, { force: true })
    throw new OfficeError('size', `Descarga incompleta (${received} de ${expect.size} bytes)`)
  }
  if (hash.digest('hex') !== expect.sha256) {
    rmSync(dest, { force: true })
    throw new OfficeError('hash', 'El SHA-256 no coincide con el esperado: se descarta el archivo')
  }
}

/** Equipo (TeamIdentifier) con el que está firmada una app, según `codesign -dvv`. */
export function parseTeamId(codesignOut: string): string | null {
  return /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(codesignOut)?.[1] ?? null
}

async function verifySignature(run: RunFile, app: string, teamId: string): Promise<void> {
  const v = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
  if (v.code !== 0) throw new OfficeError('signature', `La firma de LibreOffice no es válida: ${v.stderr.trim().slice(0, 200)}`)
  const d = await run('/usr/bin/codesign', ['-dvv', app])
  const team = parseTeamId(`${d.stdout}\n${d.stderr}`)
  if (team !== teamId) throw new OfficeError('signature', `Firmada por un equipo distinto al esperado (${team ?? 'ninguno'})`)
}

/** Instala LibreOffice (copia administrada). Devuelve la ruta de `soffice`. */
export async function installLibreOffice(
  deps: OfficeDeps,
  onProgress: (p: OfficeProgress) => void = () => undefined,
  signal?: AbortSignal
): Promise<string> {
  const status = officeStatus(deps)
  if (status.state === 'unsupported') throw new OfficeError('unsupported', status.reason)
  if (status.state === 'installed') return status.soffice
  const asset = assetFor(deps)
  const pin = deps.pin
  if (!asset || !pin) throw new OfficeError('no-pin', 'No hay descarga fijada para esta plataforma')
  const run = deps.run ?? realRun
  const fetchFn = deps.fetch ?? ((u, i) => fetch(u, i))
  mkdirSync(deps.binDir, { recursive: true, mode: 0o700 })
  // El .dmg + la copia: ~2,5 veces el tamaño de la descarga.
  const free = deps.freeBytes ? deps.freeBytes() : statfsSync(deps.binDir).bavail * statfsSync(deps.binDir).bsize
  if (free < asset.size * 2.5)
    throw new OfficeError('disk', `Espacio insuficiente: hacen falta unos ${Math.ceil((asset.size * 2.5) / 1e6)} MB libres`)
  const work = mkdtempSync(join(deps.binDir, '.libreoffice-tmp-'))
  const dmg = join(work, 'LibreOffice.dmg')
  const mount = join(work, 'mnt')
  const stage = join(work, 'stage')
  let mounted = false
  try {
    await downloadVerified(fetchFn, asset.url, dmg, asset, (done) => onProgress({ phase: 'download', done, total: asset.size }), signal)
    onProgress({ phase: 'mount' })
    mkdirSync(mount, { mode: 0o700 })
    const att = await run('/usr/bin/hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-noverify', '-mountpoint', mount, dmg])
    if (att.code !== 0) throw new OfficeError('mount', `No se pudo montar la imagen: ${att.stderr.trim().slice(0, 200)}`)
    mounted = true
    const src = join(mount, 'LibreOffice.app')
    if (!existsSync(join(src, SOFFICE_REL))) throw new OfficeError('mount', 'La imagen no contiene LibreOffice.app')
    onProgress({ phase: 'verify' })
    await verifySignature(run, src, asset.signature.teamId)
    onProgress({ phase: 'copy' })
    mkdirSync(stage, { mode: 0o700 })
    const copy = await run('/usr/bin/ditto', [src, join(stage, 'LibreOffice.app')])
    if (copy.code !== 0) throw new OfficeError('copy', `No se pudo copiar: ${copy.stderr.trim().slice(0, 200)}`)
    // La copia también se verifica: lo que se ejecutará es ESTO, no la imagen.
    await verifySignature(run, join(stage, 'LibreOffice.app'), asset.signature.teamId)
    const finalDir = join(deps.binDir, `libreoffice-${pin.version}`)
    rmSync(finalDir, { recursive: true, force: true })
    renameSync(stage, finalDir)
    writeFileSync(
      join(finalDir, 'installed.json'),
      JSON.stringify({ version: pin.version, sha256: asset.sha256, installedAt: new Date().toISOString() })
    )
    onProgress({ phase: 'done' })
    return join(finalDir, 'LibreOffice.app', SOFFICE_REL)
  } finally {
    if (mounted) await run('/usr/bin/hdiutil', ['detach', '-force', mount]).catch(() => undefined)
    rmSync(work, { recursive: true, force: true })
  }
}

export function removeLibreOffice(deps: OfficeDeps): void {
  const dir = deps.pin ? join(deps.binDir, `libreoffice-${deps.pin.version}`) : null
  if (dir && existsSync(dir) && statSync(dir).isDirectory()) rmSync(dir, { recursive: true, force: true })
}
