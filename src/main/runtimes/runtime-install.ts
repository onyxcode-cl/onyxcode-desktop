/**
 * Instalación de los runtimes de la app (F8-B195): Node.js y uv, descargados bajo demanda de las releases OFICIALES con versión,
 * tamaño y SHA-256 fijados (`resources/runtimes/pin.json`), para que los conectores locales funcionen sin que la persona instale nada.
 *
 * Garantías (cada una con prueba en `runtime-install.test.ts` / `archive.test.ts`):
 *  - Se descarga con `pinnedDownload` (el mismo de las imágenes de WSL): solo https, host de la lista de ESE runtime (Node: solo
 *    `nodejs.org`; uv: GitHub y su CDN de releases), cada redirección revisada, tope de bytes EXACTO y SHA-256 en flujo. Si la
 *    huella no coincide se borra lo descargado y NO se extrae ni se ejecuta nada.
 *  - La extracción es propia y estricta (`archive.ts`): sin rutas fuera del destino, sin enlaces peligrosos, con topes.
 *  - Todo queda en `userData/runtimes/<runtime>-<versión>/`, sin administrador, sin tocar el PATH del sistema, sin scripts de
 *    instalación ni instaladores `.pkg`/`.msi`. Se arma en una carpeta temporal y se renombra de una vez: nunca queda a medias.
 *  - Antes de dar por bueno el runtime se ejecuta `--version` y debe devolver EXACTAMENTE la versión fijada.
 *  - Los runtimes sirven SOLO a los conectores locales que la persona aprobó: esta app no los usa para nada más ni expone `npx`.
 */
import { execFile } from 'node:child_process'
import { lstatSync, readFileSync, statSync } from 'node:fs'
import { chmod, lstat, mkdir, mkdtemp, readdir, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { delimiter, isAbsolute, join, sep } from 'node:path'
import { PinnedDownloadError, pinnedDownload, type PinnedDownloadOptions } from '../tasks/backends/pinned-download'
import type { FetchLike } from '../remote/tunnel/binary'
import { fsFailureKind } from '../util/fs-error'
import { ArchiveError, extractArchive } from './archive'
import { RUNTIME_IDS, assetFor, downloadHosts, platformKey, type RuntimeId, type RuntimePin, type RuntimePinAsset } from './runtime-pin'

export type RuntimeErrorCode =
  | 'unsupported'
  | 'disk'
  /** Sin permiso de escritura en la carpeta de Lazunox (F8-B198). */
  | 'permission'
  | 'hash'
  /** Sin conexión (no se pudo llegar al sitio de descarga o se cortó a mitad) (F8-B198). */
  | 'offline'
  | 'download'
  | 'unsafe'
  | 'broken'
  | 'cancelled'
  | 'busy'
  | 'io'

/** Un fallo suelto del sistema de archivos con su causa real (disco lleno, sin permiso); `io` si no se reconoce. */
export function toRuntimeError(e: unknown): RuntimeError {
  if (e instanceof RuntimeError) return e
  const detail = e instanceof Error ? e.message.slice(0, 120) : 'io'
  return new RuntimeError(fsFailureKind(e) ?? 'io', detail)
}

export class RuntimeError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    readonly detail = ''
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

export type RuntimePhase = 'download' | 'extract' | 'verify' | 'done'
export interface RuntimeProgress {
  phase: RuntimePhase
  /** Runtime que se está preparando. */
  id: RuntimeId
  /** Bytes descargados y totales de TODO lo que falta (para una sola barra). */
  done?: number
  total?: number
}

/** Ejecuta un programa SIN shell y devuelve su salida (inyectable). */
export type RunVersion = (file: string, args: string[], env: Record<string, string>) => Promise<{ code: number | null; output: string }>

export const realRunVersion: RunVersion = (file, args, env) =>
  new Promise((done) => {
    execFile(file, args, { env, timeout: 20_000, maxBuffer: 1 << 20, windowsHide: true }, (err, stdout, stderr) => {
      const raw = err ? (err as { code?: unknown }).code : 0
      done({ code: typeof raw === 'number' ? raw : 1, output: `${stdout ?? ''}${stderr ?? ''}` })
    })
  })

export interface RuntimeDeps {
  /** `userData/runtimes`. */
  runtimesDir: string
  pin: RuntimePin | null
  platform?: string
  arch?: string
  fetch?: FetchLike
  download?: (url: string, dest: string, o: PinnedDownloadOptions) => Promise<{ cached: boolean }>
  run?: RunVersion
  freeBytes?: () => Promise<number>
}

/** Factor de espacio libre exigido respecto de lo que se descarga (archivo + lo descomprimido + margen). */
export const RUNTIME_DISK_FACTOR = 6

const MARKER = '.lazunox-runtime.json'
const platOf = (d: RuntimeDeps): string => d.platform ?? process.platform
const keyOf = (d: RuntimeDeps): string => platformKey(platOf(d), d.arch ?? process.arch)
const assetOf = (d: RuntimeDeps, id: RuntimeId): RuntimePinAsset | null => assetFor(d.pin, id, platOf(d), d.arch ?? process.arch)

/** Carpeta de un runtime (con su versión fijada). */
export function runtimeDir(d: Pick<RuntimeDeps, 'runtimesDir' | 'pin'>, id: RuntimeId): string | null {
  return d.pin ? join(d.runtimesDir, `${id}-${d.pin[id].version}`) : null
}

export type RuntimeState =
  | { state: 'unsupported' }
  | { state: 'missing'; version: string; sizeBytes: number }
  | { state: 'broken'; version: string; sizeBytes: number }
  | { state: 'installed'; version: string; dir: string; bin: string; npmCli?: string }

interface Marker {
  id?: string
  version?: string
  sha256?: string
  binSize?: number
}

function readMarker(dir: string): Marker {
  try {
    const o = JSON.parse(readFileSync(join(dir, MARKER), 'utf8')) as unknown
    return o && typeof o === 'object' && !Array.isArray(o) ? (o as Marker) : {}
  } catch {
    return {}
  }
}

/** Estado en disco de UN runtime. Solo mira el disco (sin red ni procesos); síncrono y barato (unos pocos `lstat`). */
export function inspectRuntime(d: RuntimeDeps, id: RuntimeId): RuntimeState {
  const asset = assetOf(d, id)
  const dir = runtimeDir(d, id)
  if (!asset || !dir || !d.pin) return { state: 'unsupported' }
  const version = d.pin[id].version
  try {
    const top = lstatSync(dir)
    if (!top.isDirectory() || top.isSymbolicLink()) return { state: 'broken', version, sizeBytes: asset.size }
  } catch {
    return { state: 'missing', version, sizeBytes: asset.size }
  }
  const m = readMarker(dir)
  if (m.id !== id || m.version !== version || m.sha256 !== asset.sha256) return { state: 'broken', version, sizeBytes: asset.size }
  try {
    const bin = join(dir, ...asset.bin.split('/'))
    const st = lstatSync(bin)
    if (!st.isFile() || st.size === 0 || st.size !== m.binSize) return { state: 'broken', version, sizeBytes: asset.size }
    let npmCli: string | undefined
    if (asset.npmCli) {
      npmCli = join(dir, ...asset.npmCli.split('/'))
      const ns = statSync(npmCli)
      if (!ns.isFile()) return { state: 'broken', version, sizeBytes: asset.size }
    }
    return { state: 'installed', version, dir, bin, ...(npmCli ? { npmCli } : {}) }
  } catch {
    return { state: 'broken', version, sizeBytes: asset.size }
  }
}

export interface RuntimesStatus {
  node: RuntimeState
  uv: RuntimeState
  /** Bytes que faltan por descargar (lo no instalado). */
  missingBytes: number
  /** Los dos están listos. */
  ready: boolean
  /** Ninguno aplica a esta plataforma. */
  unsupported: boolean
}

export function runtimesStatus(d: RuntimeDeps): RuntimesStatus {
  const node = inspectRuntime(d, 'node')
  const uv = inspectRuntime(d, 'uv')
  const missing = (s: RuntimeState): number => (s.state === 'missing' || s.state === 'broken' ? s.sizeBytes : 0)
  const unsupported = node.state === 'unsupported' && uv.state === 'unsupported'
  return {
    node,
    uv,
    missingBytes: missing(node) + missing(uv),
    ready: node.state === 'installed' && uv.state === 'installed',
    unsupported
  }
}

/** PATH acotado: las carpetas dadas (del propio runtime) y las del sistema imprescindibles. Nunca el PATH del usuario. */
export function scopedPath(platform: string, binDirs: string[]): string {
  const win = platform === 'win32'
  const sys = win ? [join(process.env.SystemRoot || 'C:\\Windows', 'System32')] : ['/usr/bin', '/bin']
  return [...binDirs, ...sys].join(win ? ';' : delimiter)
}

/** Entorno MÍNIMO para ejecutar un runtime: PATH acotado a la propia carpeta del runtime y a las del sistema, sin variables del usuario. */
export function scopedEnv(platform: string, binDirs: string[]): Record<string, string> {
  const env: Record<string, string> = { PATH: scopedPath(platform, binDirs), LANG: 'en_US.UTF-8', NO_COLOR: '1' }
  if (platform === 'win32' && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
  return env
}

const VERSION_OUT: Record<RuntimeId, (v: string) => RegExp> = {
  node: (v) => new RegExp(`^v${v.replace(/\./g, '\\.')}\\s*$`),
  uv: (v) => new RegExp(`^uv ${v.replace(/\./g, '\\.')}(?:\\s|$)`)
}

async function freeBytesOf(path: string): Promise<number> {
  const s = await statfs(path)
  return s.bavail * s.bsize
}

/** Instala (o repara) un runtime. Devuelve su estado ya verificado. */
async function installOne(
  d: RuntimeDeps,
  id: RuntimeId,
  base: { before: number; total: number },
  onProgress: (p: RuntimeProgress) => void,
  signal?: AbortSignal
): Promise<RuntimeState> {
  const asset = assetOf(d, id)
  const dir = runtimeDir(d, id)
  if (!asset || !dir || !d.pin) throw new RuntimeError('unsupported')
  const version = d.pin[id].version
  const work = await mkdtemp(join(d.runtimesDir, '.tmp-')).catch((e: unknown) => {
    throw toRuntimeError(e)
  })
  try {
    const archive = join(work, 'archivo')
    const stage = join(work, 'stage')
    onProgress({ phase: 'download', id, done: base.before, total: base.total })
    try {
      await (d.download ?? pinnedDownload)(asset.url, archive, {
        fetch: d.fetch ?? ((u, i) => fetch(u, i)),
        size: asset.size,
        sha256: asset.sha256,
        hosts: downloadHosts(id),
        signal,
        onBytes: (done) => onProgress({ phase: 'download', id, done: base.before + done, total: base.total })
      })
    } catch (e) {
      const code = e instanceof PinnedDownloadError ? e.code : signal?.aborted ? 'aborted' : (fsFailureKind(e) ?? 'io')
      if (code === 'aborted') throw new RuntimeError('cancelled')
      if (code === 'bad-hash' || code === 'bad-size' || code === 'too-big') throw new RuntimeError('hash', code)
      if (code === 'disk' || code === 'permission' || code === 'offline') throw new RuntimeError(code, code)
      if (code === 'bad-url' || code === 'bad-host' || code === 'too-many-redirects') throw new RuntimeError('unsafe', code)
      throw new RuntimeError('download', code)
    }
    onProgress({ phase: 'extract', id, done: base.before + asset.size, total: base.total })
    try {
      await extractArchive(
        archive,
        asset.format,
        stage,
        { strip: asset.strip, into: asset.into, unpackedMax: asset.unpackedMax, maxEntries: asset.maxEntries },
        signal
      )
    } catch (e) {
      if (e instanceof ArchiveError) throw new RuntimeError(e.code === 'aborted' ? 'cancelled' : 'unsafe', e.message)
      throw e
    }
    await rm(archive, { force: true })
    const bin = join(stage, ...asset.bin.split('/'))
    const st = await lstat(bin).catch(() => null)
    if (!st || !st.isFile() || st.size === 0) throw new RuntimeError('broken', 'sin ejecutable')
    if (platOf(d) !== 'win32') await chmod(bin, 0o755)
    if (asset.npmCli) {
      const ns = await lstat(join(stage, ...asset.npmCli.split('/'))).catch(() => null)
      if (!ns || !ns.isFile()) throw new RuntimeError('broken', 'sin npm')
    }
    onProgress({ phase: 'verify', id, done: base.before + asset.size, total: base.total })
    // Prueba de humo: debe responder con EXACTAMENTE la versión fijada.
    const out = await (d.run ?? realRunVersion)(bin, ['--version'], scopedEnv(platOf(d), [join(bin, '..')]))
    if (out.code !== 0 || !VERSION_OUT[id](version).test(out.output.trim()))
      throw new RuntimeError('broken', `versión: ${out.output.trim().slice(0, 60)}`)
    await writeFile(
      join(stage, MARKER),
      JSON.stringify({ id, version, sha256: asset.sha256, binSize: st.size, installedAt: new Date().toISOString() }),
      { mode: 0o600 }
    )
    await rm(dir, { recursive: true, force: true })
    await rename(stage, dir)
  } catch (e) {
    throw toRuntimeError(e)
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined)
  }
  const after = inspectRuntime(d, id)
  if (after.state !== 'installed') throw new RuntimeError('broken', 'tras instalar')
  return after
}

/**
 * Instala lo que falte (Node y uv) y devuelve el estado final. Si uno falla, lanza su error (el otro, si ya se instaló, queda).
 * Se puede reintentar: lo que ya está bien no se vuelve a descargar.
 */
export async function installRuntimes(
  d: RuntimeDeps,
  onProgress: (p: RuntimeProgress) => void = () => undefined,
  signal?: AbortSignal
): Promise<RuntimesStatus> {
  if (!d.pin || RUNTIME_IDS.every((id) => !assetOf(d, id))) throw new RuntimeError('unsupported', keyOf(d))
  await mkdir(d.runtimesDir, { recursive: true, mode: 0o700 }).catch((e: unknown) => {
    throw toRuntimeError(e)
  })
  const before = runtimesStatus(d)
  const todo = RUNTIME_IDS.filter((id) => {
    const s = id === 'node' ? before.node : before.uv
    return s.state === 'missing' || s.state === 'broken'
  })
  if (todo.length === 0) return before
  const total = todo.reduce((n, id) => n + (assetOf(d, id)?.size ?? 0), 0)
  const need = total * RUNTIME_DISK_FACTOR
  const free = await (d.freeBytes ?? (() => freeBytesOf(d.runtimesDir)))().catch(() => Infinity)
  if (free < need) throw new RuntimeError('disk', `${Math.ceil(need / 1e6)} MB`)
  let done = 0
  for (const id of todo) {
    await installOne(d, id, { before: done, total }, onProgress, signal)
    done += assetOf(d, id)!.size
  }
  onProgress({ phase: 'done', id: todo[todo.length - 1]!, done: total, total })
  await cleanStaleTemp(d.runtimesDir)
  return runtimesStatus(d)
}

/** Borra carpetas temporales abandonadas por un cierre a mitad de instalación (`.tmp-*`). Nunca falla. */
export async function cleanStaleTemp(runtimesDir: string): Promise<void> {
  try {
    for (const e of await readdir(runtimesDir, { withFileTypes: true }))
      if (e.isDirectory() && e.name.startsWith('.tmp-')) await rm(join(runtimesDir, e.name), { recursive: true, force: true })
  } catch {
    // nada que limpiar
  }
}

/** Quita los runtimes (la carpeta `runtimes` entera). Los conectores locales instalados dejan de arrancar hasta reinstalarlos. */
export async function removeRuntimes(runtimesDir: string): Promise<void> {
  await rm(runtimesDir, { recursive: true, force: true })
}

export interface AppRuntimeBins {
  /** Ejecutable de uv del runtime de la app, o `null`. */
  uv: string | null
  node: string | null
  npmCli: string | null
}

/** Rutas ABSOLUTAS de lo instalado por la app (para los conectores locales). */
export function appRuntimeBins(d: RuntimeDeps): AppRuntimeBins {
  const st = runtimesStatus(d)
  return {
    uv: st.uv.state === 'installed' ? st.uv.bin : null,
    node: st.node.state === 'installed' ? st.node.bin : null,
    npmCli: st.node.state === 'installed' ? (st.node.npmCli ?? null) : null
  }
}

/** ¿`p` está dentro de `dir`? (para que nada fuera de la carpeta de runtimes se tome por suyo). */
export function isUnder(dir: string, p: string): boolean {
  return isAbsolute(p) && p.startsWith(dir.endsWith(sep) ? dir : dir + sep)
}
