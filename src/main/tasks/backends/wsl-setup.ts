/**
 * Orquestación de `setup()` y `remove()` del backend WSL (F8-B81, tanda B1). NO SE ACTIVA EN PRODUCCIÓN.
 *
 * Todo lo que toca el sistema entra por `WslSetupDeps` (wsl.exe, descarga, disco, reloj): se prueba entero con dobles.
 * Instalación completa, en este orden (plan A-rootfs §5), con rollback en cada paso posterior al import:
 *   0 validar `LOCALAPPDATA`  · cerrojo de un solo setup  · 1 estado (`needsSetup`)  · 3 espacio libre ≥ 2 GB
 *   4 imagen (0-55 %)  · 5 opencode (55-70 %)  · (carga LZPK1 codificada ANTES de tocar WSL)
 *   6 `lstat(installDir)` sin reparse  · 7 sha otra vez + `wsl --import … --version 2` (10 min)
 *   8 `-l -v`: versión 2 (si no, `--unregister` y `wsl1`)  · 9 carga por stdin  · 10 probe `ready`
 *   11 `--terminate`, `state.json` y borrar la caché.
 * Cancelación por `AbortSignal` hasta el import; durante el import se espera y se aplica el mismo rollback.
 * Nunca `--shutdown`; `--unregister` solo del nombre propio; solo se borran nombres conocidos dentro de `installDir`,
 * la caché y `state.json`. Actualizar la carga NUNCA desregistra (el instalador es atómico): no se pierden datos.
 */
import { createHash } from 'node:crypto'
import { win32 } from 'node:path'
import { Readable } from 'node:stream'
import { decodeWslOutput } from './bridge-protocol'
import { PinnedDownloadError, type PinnedDownloadOptions, type PinnedDownloadResult } from './pinned-download'
import {
  LZPK_MODE_EXEC,
  LZPK_MODE_FILE,
  LZPK_OPENCODE_PATH,
  LZPK_PATH_RE,
  LzpkError,
  encodeLzpk,
  sha256Hex,
  type LzpkInputFile,
  type LzpkResult
} from './wsl-payload'
import { compareWslRootfsVersion, parseWslPin, type WslPin } from './wsl-pin'
import { LANDLOCK_MIN_ABI, WSL_DISTRO, type WslCommand } from './wsl-spec'
import { classifyWslStatus, parseDistroList, parseProbe, type RunResult, type StatusInputs, type WslStatus } from './wsl-status'
import { toSandboxPath } from './wsl-paths'

// ───────────────────────── Constantes ─────────────────────────

export const WSL_DOWNLOAD_HOSTS: readonly string[] = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
export const WSL_MIN_FREE_BYTES = 2 * 1024 ** 3
/** Holgura para reparar solo la carga (opencode se descarga y se envía: no se importa nada). */
export const WSL_PAYLOAD_FREE_MARGIN = 256 * 1024 ** 2
export const WSL_IMPORT_TIMEOUT_MS = 10 * 60_000
export const WSL_INSTALL_TIMEOUT_MS = 120_000
export const WSL_HOME_TIMEOUT_MS = 10 * 60_000
const LIST_MS = 20_000
const PROBE_MS = 60_000
const TERMINATE_MS = 30_000
const UNREGISTER_MS = 120_000
export const WSL_VHDX_NAME = 'ext4.vhdx'
export const WSL_HOME_BACKUP_NAME = 'home-backup.tar'
export const WSL_STATE_NAME = 'state.json'
const CACHE_FILE_RE = /^(?:rootfs|opencode)-[0-9a-f]{12}\.tar\.gz(?:\.part)?$/
const OPENCODE_MAX_SIZE = 400 * 1024 ** 2
const HEX64 = /^[0-9a-f]{64}$/

// ───────────────────────── Tipos ─────────────────────────

export type WslSetupErrorCode =
  | 'bad-localappdata'
  | 'no-pin'
  | 'busy'
  | 'blocked'
  | 'foreign'
  | 'no-space'
  | 'offline'
  | 'download-failed'
  | 'bad-hash'
  | 'bad-payload'
  | 'bad-bundle'
  | 'bad-installdir'
  | 'import-failed'
  | 'import-timeout'
  | 'wsl1'
  | 'payload-failed'
  | 'probe-failed'
  | 'home-restore-failed'
  | 'backup-failed'
  | 'unregister-failed'
  | 'state-failed'
  | 'aborted'
  | 'unsupported'
  | 'io'

export class WslSetupError extends Error {
  constructor(
    readonly code: WslSetupErrorCode,
    readonly detail?: string
  ) {
    super(detail ? `${code}:${detail}` : code)
    this.name = 'WslSetupError'
  }
}

export interface FsEntry {
  isSymbolicLink(): boolean
  isDirectory(): boolean
  isFile(): boolean
  size: number
}

/** Disco: cada método actúa sobre UNA ruta; `rm` es solo de archivos (force) y `rmdir` solo de carpetas vacías. */
export interface WslSetupFs {
  /** Recursivo. */
  mkdir(p: string): Promise<void>
  /** `null` si no existe. No sigue enlaces. */
  lstat(p: string): Promise<FsEntry | null>
  readdir(p: string): Promise<string[]>
  rename(from: string, to: string): Promise<void>
  rm(p: string): Promise<void>
  /** Rechaza si no está vacía. */
  rmdir(p: string): Promise<void>
  /** Bytes libres de la unidad de `p`. */
  freeBytes(p: string): Promise<number>
  sha256(p: string): Promise<string>
  readFile(p: string): Promise<Buffer>
  writeFile(p: string, data: string): Promise<void>
  readStream(p: string): Readable
  /** Copia `from` a `to` (sobrescribe `to`). */
  copyFile(from: string, to: string): Promise<void>
}

export interface SetupOpencodePin {
  version: string
  url: string
  sha256: string
  size: number
}

export interface SetupPin {
  rootfs: WslPin
  opencode: SetupOpencodePin
}

export interface WslSetupDeps {
  platform: string
  policyDisabled?: () => boolean
  /** `wsl.exe` hasta el final con tiempo límite. */
  run(cmd: WslCommand, ms: number): Promise<RunResult>
  /** Igual, pero con `input` por stdin (carga LZPK1, tar de datos). */
  runWithInput(cmd: WslCommand, input: Readable, ms: number): Promise<RunResult>
  /** Igual, pero el stdout se escribe a `dest` (no se acumula en memoria). */
  runToFile(cmd: WslCommand, dest: string, ms: number): Promise<RunResult>
  download(url: string, dest: string, o: Omit<PinnedDownloadOptions, 'fetch'>): Promise<PinnedDownloadResult>
  fs: WslSetupFs
  /**
   * Archivo INCLUIDO en el instalador (`<resources>/wsl/images/...`) para la imagen o el opencode `linux-x64`; `null` si esta
   * compilación no lo lleva (entonces se descarga). Con archivo incluido NO hay red ni descarga alternativa: si su tamaño o su
   * sha256 no coinciden con el pin falla cerrado (`bad-bundle`). Siempre se copia a la caché: nunca se usa en el sitio.
   */
  localSource?(kind: 'rootfs' | 'opencode'): string | null
  /** `%LOCALAPPDATA%` tal cual (se valida aquí). */
  localAppData: string | undefined
  pin(): SetupPin | null
  /** Los `.py` de la carga (sin `bin/opencode`, que sale de la descarga fijada). */
  payloadFiles(): Promise<LzpkInputFile[]>
  now(): number
  log(msg: string): void
}

export interface WslSetupPaths {
  root: string
  installDir: string
  cacheDir: string
  statePath: string
}

export interface WslSetupOptions {
  signal?: AbortSignal
  kind?: 'install' | 'repair' | 'update'
}

export type ProgressFn = (pct: number, phase: string) => void

export interface WslSetupState {
  rootfsVersion: string
  rootfsSha: string
  payloadSha: string
  importedAt: string
}

// ───────────────────────── Puro ─────────────────────────

/** `%LOCALAPPDATA%` validada (absoluta con unidad, sin UNC ni 8.3) y las rutas derivadas. Local, nunca Roaming. */
export function wslSetupPaths(localAppData: string | undefined): WslSetupPaths {
  if (typeof localAppData !== 'string' || localAppData.includes('"') || !toSandboxPath(localAppData).ok) {
    throw new WslSetupError('bad-localappdata')
  }
  const root = win32.join(win32.normalize(localAppData), 'Lazunox', 'wsl')
  return {
    root,
    installDir: win32.join(root, WSL_DISTRO),
    cacheDir: win32.join(root, 'cache'),
    statePath: win32.join(root, WSL_STATE_NAME)
  }
}

/** Lee `pin.json` completo: clave `wsl-rootfs` (estricta) + asset `linux-x64` de opencode (misma `version`). Null ante cualquier desvío. */
export function parseSetupPin(raw: unknown): SetupPin | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const rootfs = parseWslPin(r['wsl-rootfs'])
  const version = r.version
  const asset = (r.assets as Record<string, unknown> | undefined)?.['linux-x64'] as Record<string, unknown> | undefined
  if (!rootfs || typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) || !asset || typeof asset !== 'object') return null
  const { url, sha256, size } = asset
  const re = new RegExp(
    `^https://github\\.com/anomalyco/opencode/releases/download/v${version.replace(/\./g, '\\.')}/[0-9A-Za-z._-]+\\.tar\\.gz$`
  )
  if (typeof url !== 'string' || !re.test(url)) return null
  if (typeof sha256 !== 'string' || !HEX64.test(sha256)) return null
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > OPENCODE_MAX_SIZE) return null
  return { rootfs, opencode: { version, url, sha256, size } }
}

/**
 * `payloadSha` esperado SIN tener el `.tar.gz` de opencode a mano (solo su sha y tamaño del pin). Replica el manifiesto de
 * `encodeLzpk` (su prueba comprueba que da lo mismo): sirve para que `status` detecte `update:payload`.
 */
export function expectedPayloadSha(py: readonly LzpkInputFile[], opencode: { sha256: string; size: number }): string {
  const files = py.map((f) => {
    if (!LZPK_PATH_RE.test(f.path) || f.path === LZPK_OPENCODE_PATH) throw new LzpkError('bad-path', f.path)
    return {
      path: f.path,
      size: f.data.byteLength,
      sha256: sha256Hex(f.data),
      mode: f.path === 'launcher.py' ? LZPK_MODE_EXEC : LZPK_MODE_FILE,
      kind: 'file'
    }
  })
  files.push({ path: LZPK_OPENCODE_PATH, size: opencode.size, sha256: opencode.sha256, mode: LZPK_MODE_EXEC, kind: 'opencode-tgz' })
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return createHash('sha256')
    .update(
      Buffer.from(
        JSON.stringify({ v: 1, files: files.map((f) => ({ path: f.path, size: f.size, sha256: f.sha256, mode: f.mode, kind: f.kind })) }),
        'utf8'
      )
    )
    .digest('hex')
}

const ok = (r: RunResult): boolean => r.code === 0 && !r.error

/** Lo que `status` necesita del pin para detectar actualizaciones. */
export type ExpectedState = Pick<StatusInputs, 'expectedRootfsVersion' | 'minRootfsVersion' | 'expectedPayloadSha'>

export interface StatusRead {
  status: WslStatus
  version: RunResult
  list: RunResult
}

/** Estado completo (versión, lista y, si procede, probe). El probe arranca la distro: solo si ya existe y no hay nada más grave. */
export async function readWslStatus(
  run: (cmd: WslCommand, ms: number) => Promise<RunResult>,
  o: { platform: string; policyDisabled?: () => boolean; expected?: ExpectedState }
): Promise<StatusRead> {
  const empty: RunResult = { code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
  if (o.platform !== 'win32') return { status: { state: 'unsupported' }, version: empty, list: empty }
  if (o.policyDisabled?.()) return { status: { state: 'policyDisabled' }, version: empty, list: empty }
  const version = await run({ kind: 'version' }, LIST_MS)
  const list = await run({ kind: 'list' }, LIST_MS)
  let probe: RunResult | null = null
  const pre = classifyWslStatus({ version, list })
  if (pre.state === 'broken' && pre.detail === 'probe') probe = await run({ kind: 'probe' }, PROBE_MS)
  return { status: classifyWslStatus({ version, list, probe, ...o.expected }), version, list }
}

// ───────────────────────── Cerrojo ─────────────────────────

const LOCKS = new Set<string>()

// ───────────────────────── Orquestador ─────────────────────────

interface SetupFiles {
  rootfsPath: string | null
  opencodePath: string
  payload: LzpkResult
}

interface Ctx {
  p: WslSetupPaths
  pin: SetupPin
  progress: ProgressFn
  signal?: AbortSignal
  version: RunResult
}

export interface WslSetupApi {
  setup(onProgress: ProgressFn, opts?: WslSetupOptions): Promise<void>
  remove(): Promise<void>
  /** Valores del pin para `status` (undefined si no hay pin o no se puede leer la carga). */
  expected(): Promise<ExpectedState | undefined>
  status(): Promise<WslStatus>
}

export function createWslSetup(deps: WslSetupDeps): WslSetupApi {
  const { fs } = deps
  const safeRun = async (cmd: WslCommand, ms: number): Promise<RunResult> => {
    try {
      return await deps.run(cmd, ms)
    } catch (e) {
      return { code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: String((e as Error)?.message ?? e) }
    }
  }
  const expected = async (): Promise<ExpectedState | undefined> => {
    try {
      const pin = deps.pin()
      if (!pin) return undefined
      return {
        expectedRootfsVersion: pin.rootfs.version,
        minRootfsVersion: pin.rootfs.minVersion,
        expectedPayloadSha: expectedPayloadSha(await deps.payloadFiles(), pin.opencode)
      }
    } catch {
      return undefined
    }
  }
  const readStatus = async (): Promise<StatusRead> =>
    readWslStatus(safeRun, { platform: deps.platform, policyDisabled: deps.policyDisabled, expected: await expected() })

  const withLock = async <T>(p: WslSetupPaths, fn: () => Promise<T>): Promise<T> => {
    const key = p.root.toLowerCase()
    if (LOCKS.has(key)) throw new WslSetupError('busy')
    LOCKS.add(key)
    try {
      return await fn()
    } finally {
      LOCKS.delete(key)
    }
  }

  const monotonic = (cb: ProgressFn): ProgressFn => {
    let last = -1
    let lastPhase = ''
    return (pct, phase) => {
      const v = Math.max(last, Math.min(100, Math.round(pct)))
      if (v === last && phase === lastPhase) return
      last = v
      lastPhase = phase
      cb(v, phase)
    }
  }

  // ── disco: solo nombres conocidos ──

  /** `installDir` debe ser una carpeta normal: un enlace o una junction harían que borrar siguiera el enlace. */
  const checkInstallDir = async (p: WslSetupPaths): Promise<'missing' | 'ok'> => {
    let st: FsEntry | null
    try {
      st = await fs.lstat(p.installDir)
    } catch {
      throw new WslSetupError('bad-installdir', 'lstat')
    }
    if (st === null) return 'missing'
    if (st.isSymbolicLink() || !st.isDirectory()) throw new WslSetupError('bad-installdir', st.isSymbolicLink() ? 'reparse' : 'not-dir')
    return 'ok'
  }

  /** Borra archivos conocidos de `installDir` (con `lstat`: un enlace no se sigue) y la carpeta si queda vacía. */
  const cleanInstallDir = async (p: WslSetupPaths, names: readonly string[]): Promise<void> => {
    try {
      if ((await checkInstallDir(p)) === 'missing') return
    } catch (e) {
      deps.log(`no se limpia installDir: ${(e as Error).message}`)
      return
    }
    for (const n of names) {
      const f = win32.join(p.installDir, n)
      try {
        const st = await fs.lstat(f)
        if (st && !st.isSymbolicLink() && st.isFile()) await fs.rm(f)
        else if (st) deps.log(`no se borra ${n}: no es un archivo normal`)
      } catch (e) {
        deps.log(`no se pudo borrar ${n}: ${String((e as Error)?.message ?? e)}`)
      }
    }
    await fs.rmdir(p.installDir).catch(() => deps.log('installDir no queda vacío: se deja'))
  }

  const cleanCache = async (p: WslSetupPaths): Promise<void> => {
    let names: string[]
    try {
      names = await fs.readdir(p.cacheDir)
    } catch {
      return
    }
    for (const n of names.filter((x) => CACHE_FILE_RE.test(x))) await fs.rm(win32.join(p.cacheDir, n)).catch(() => undefined)
    await fs.rmdir(p.cacheDir).catch(() => undefined)
  }

  /** Deshace una distro a medio crear: SOLO nuestro nombre; borra `ext4.vhdx` y la carpeta si queda vacía (el respaldo se conserva). */
  const rollback = async (p: WslSetupPaths, why: string): Promise<void> => {
    deps.log(`rollback: ${why}`)
    const r = await safeRun({ kind: 'unregister' }, UNREGISTER_MS)
    if (!ok(r)) deps.log('rollback: --unregister no terminó bien')
    await cleanInstallDir(p, [WSL_VHDX_NAME])
  }

  const stateExists = async (p: WslSetupPaths): Promise<boolean> => {
    try {
      const st = await fs.lstat(p.statePath)
      return !!st && st.isFile() && !st.isSymbolicLink()
    } catch {
      return false
    }
  }

  const writeState = async (p: WslSetupPaths, s: WslSetupState): Promise<void> => {
    const tmp = `${p.statePath}.tmp`
    await fs.writeFile(tmp, JSON.stringify(s))
    await fs.rename(tmp, p.statePath)
  }

  const checkSpace = async (p: WslSetupPaths, need: number): Promise<void> => {
    let free: number
    try {
      await fs.mkdir(p.cacheDir)
      free = await fs.freeBytes(p.root)
    } catch {
      throw new WslSetupError('io', 'space')
    }
    if (!(free >= need)) throw new WslSetupError('no-space', String(free))
  }

  // ── descargas ──

  const download = async (
    ctx: Ctx,
    what: string,
    url: string,
    dest: string,
    size: number,
    sha256: string,
    lo: number,
    hi: number
  ): Promise<void> => {
    ctx.progress(lo, 'downloading')
    try {
      await deps.download(url, dest, {
        size,
        sha256,
        hosts: WSL_DOWNLOAD_HOSTS,
        signal: ctx.signal,
        onBytes: (done, total) => ctx.progress(lo + ((hi - lo) * done) / total, 'downloading')
      })
    } catch (e) {
      const code = e instanceof PinnedDownloadError ? e.code : ctx.signal?.aborted ? 'aborted' : 'io'
      deps.log(`descarga de ${what}: ${code}`)
      if (code === 'aborted') throw new WslSetupError('aborted')
      if (code === 'offline') throw new WslSetupError('offline')
      throw new WslSetupError(code === 'bad-hash' ? 'bad-hash' : 'download-failed', `${what}:${code}`)
    }
    ctx.progress(hi, 'downloading')
  }

  const abortCheck = (ctx: Ctx): void => {
    if (ctx.signal?.aborted) throw new WslSetupError('aborted')
  }

  /**
   * Origen local: copia el archivo incluido a la caché (`dest`) con la MISMA verificación que `pinnedDownload` (tamaño exacto y
   * sha256, vía `.part` y renombrado). Si `dest` ya está en caché con la huella buena no copia. Cualquier fallo es `bad-bundle`.
   */
  const copyLocal = async (
    ctx: Ctx,
    what: 'rootfs' | 'opencode',
    src: string,
    dest: string,
    size: number,
    sha256: string,
    lo: number,
    hi: number
  ): Promise<void> => {
    ctx.progress(lo, 'verifying')
    const part = `${dest}.part`
    const bad = (why: string): WslSetupError => {
      deps.log(`archivo incluido de ${what}: ${why}`)
      return new WslSetupError('bad-bundle', `${what}:${why}`)
    }
    try {
      const cached = await fs.lstat(dest)
      if (cached && cached.isFile() && !cached.isSymbolicLink() && cached.size === size && (await fs.sha256(dest)) === sha256) {
        ctx.progress(hi, 'verifying')
        return
      }
      abortCheck(ctx)
      const st = await fs.lstat(src)
      if (!st) throw bad('missing')
      if (st.isSymbolicLink() || !st.isFile()) throw bad('not-file')
      if (st.size !== size) throw bad('size')
      await fs.copyFile(src, part)
      abortCheck(ctx)
      const copied = await fs.lstat(part)
      if (!copied || !copied.isFile() || copied.isSymbolicLink() || copied.size !== size) throw bad('size')
      if ((await fs.sha256(part)) !== sha256) throw bad('hash')
      abortCheck(ctx)
      await fs.rename(part, dest)
    } catch (e) {
      await fs.rm(part).catch(() => undefined)
      if (e instanceof WslSetupError) throw e
      throw new WslSetupError('bad-bundle', `${what}:io`)
    }
    ctx.progress(hi, 'verifying')
  }

  /** Imagen/opencode: el archivo incluido va PRIMERO (sin red, falla cerrado); sin él, la descarga fijada de siempre. */
  const obtain = async (
    ctx: Ctx,
    what: 'rootfs' | 'opencode',
    url: string,
    dest: string,
    size: number,
    sha256: string,
    lo: number,
    hi: number
  ): Promise<void> => {
    const src = deps.localSource?.(what) ?? null
    if (src !== null) await copyLocal(ctx, what, src, dest, size, sha256, lo, hi)
    else await download(ctx, what, url, dest, size, sha256, lo, hi)
  }

  /** Pasos 4-5 y la carga LZPK1 (se codifica antes de tocar WSL: un fallo aquí no deja nada). */
  const acquire = async (ctx: Ctx, withRootfs: boolean): Promise<SetupFiles> => {
    const { pin, p } = ctx
    let rootfsPath: string | null = null
    if (withRootfs) {
      rootfsPath = win32.join(p.cacheDir, `rootfs-${pin.rootfs.sha256.slice(0, 12)}.tar.gz`)
      await obtain(ctx, 'rootfs', pin.rootfs.url, rootfsPath, pin.rootfs.size, pin.rootfs.sha256, 0, 55)
      abortCheck(ctx)
    }
    const opencodePath = win32.join(p.cacheDir, `opencode-${pin.opencode.sha256.slice(0, 12)}.tar.gz`)
    const lo = withRootfs ? 55 : 0
    await obtain(ctx, 'opencode', pin.opencode.url, opencodePath, pin.opencode.size, pin.opencode.sha256, lo, 70)
    abortCheck(ctx)
    let payload: LzpkResult
    try {
      const py = await deps.payloadFiles()
      payload = encodeLzpk([...py, { path: LZPK_OPENCODE_PATH, data: await fs.readFile(opencodePath) }])
    } catch (e) {
      throw new WslSetupError('bad-payload', e instanceof LzpkError ? e.reason : 'read')
    }
    return { rootfsPath, opencodePath, payload }
  }

  // ── comprobaciones dentro de la distro ──

  const parseInstallLine = (r: RunResult): { ok?: boolean; payloadSha?: string } | null => {
    try {
      return JSON.parse(decodeWslOutput(r.stdout).trim().split('\n').pop() ?? '') as { ok?: boolean; payloadSha?: string }
    } catch {
      return null
    }
  }

  const installPayload = async (art: SetupFiles): Promise<boolean> => {
    const r = await deps
      .runWithInput({ kind: 'install' }, Readable.from([art.payload.buffer], { objectMode: false }), WSL_INSTALL_TIMEOUT_MS)
      .catch((): RunResult => ({ code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: 'throw' }))
    const line = ok(r) ? parseInstallLine(r) : null
    return !!line && line.ok === true && line.payloadSha === art.payload.payloadSha
  }

  /** Paso 10: el probe tiene que dar `ready` y coincidir con la imagen y la carga fijadas. Devuelve el motivo si falla. */
  const probeReady = async (ctx: Ctx, art: SetupFiles, list: RunResult): Promise<string | null> => {
    const probe = await safeRun({ kind: 'probe' }, PROBE_MS)
    const st = classifyWslStatus({
      version: ctx.version,
      list,
      probe,
      expectedRootfsVersion: ctx.pin.rootfs.version,
      minRootfsVersion: ctx.pin.rootfs.minVersion,
      expectedPayloadSha: art.payload.payloadSha
    })
    if (st.state !== 'ready') return `${st.state}${st.detail ? `:${st.detail}` : ''}`
    const info = ok(probe) ? parseProbe(decodeWslOutput(probe.stdout)) : null
    if (!info) return 'probe'
    if (info.interop) return 'interop'
    if (info.driveMounts.length > 0) return 'drives'
    if (info.landlockAbi < LANDLOCK_MIN_ABI) return `landlock:${info.landlockAbi}`
    if (!info.rootfs || compareWslRootfsVersion(info.rootfs.version, ctx.pin.rootfs.version) !== 0) return 'rootfs-version'
    if (info.payloadSha !== art.payload.payloadSha) return 'payload-sha'
    return null
  }

  // ── pasos 6-11 (con rollback) ──

  const createDistro = async (ctx: Ctx, art: SetupFiles, abortable: boolean): Promise<void> => {
    const { p, pin } = ctx
    const tar = art.rootfsPath!
    ctx.progress(70, 'verifying')
    // Paso 6: carpeta propia, sin reparse points; si existe, solo se borra el `ext4.vhdx` residual.
    if ((await checkInstallDir(p)) === 'ok') {
      const v = win32.join(p.installDir, WSL_VHDX_NAME)
      const st = await fs.lstat(v).catch(() => null)
      if (st) {
        if (st.isSymbolicLink() || !st.isFile()) throw new WslSetupError('bad-installdir', 'vhdx')
        await fs.rm(v)
      }
    }
    try {
      await fs.mkdir(p.installDir)
    } catch {
      throw new WslSetupError('io', 'mkdir')
    }
    // Paso 7: la huella otra vez, justo antes de importar.
    let got: string
    try {
      got = await fs.sha256(tar)
    } catch {
      throw new WslSetupError('io', 'rehash')
    }
    if (got !== pin.rootfs.sha256) {
      await fs.rm(tar).catch(() => undefined)
      throw new WslSetupError('bad-hash', 'rehash')
    }
    ctx.progress(72, 'verifying')
    if (abortable) abortCheck(ctx)
    ctx.progress(72, 'creating')
    const fail = async (code: WslSetupErrorCode, detail?: string): Promise<never> => {
      await rollback(p, `${code}${detail ? `:${detail}` : ''}`)
      throw new WslSetupError(code, detail)
    }
    const imp = await deps
      .run({ kind: 'import', installDir: p.installDir, rootfsTar: tar }, WSL_IMPORT_TIMEOUT_MS)
      .catch((): RunResult => ({ code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: 'throw' }))
    if (!ok(imp)) return fail(imp.error === 'timeout' ? 'import-timeout' : 'import-failed', String(imp.code ?? imp.error ?? '?'))
    // Durante el import no se puede cancelar: se esperó y ahora se deshace.
    if (abortable && ctx.signal?.aborted) return fail('aborted')
    try {
      ctx.progress(88, 'creating')
      // Paso 8: tiene que ser versión 2.
      const list = await safeRun({ kind: 'list' }, LIST_MS)
      const mine = ok(list) ? parseDistroList(decodeWslOutput(list.stdout)).find((d) => d.name === WSL_DISTRO) : undefined
      if (!mine) return await fail('import-failed', 'not-registered')
      if (mine.version !== 2) return await fail('wsl1')
      // Paso 9: la carga por stdin.
      ctx.progress(88, 'installing')
      if (!(await installPayload(art))) return await fail('payload-failed')
      // Paso 10: probe completo.
      ctx.progress(95, 'checking')
      const bad = await probeReady(ctx, art, list)
      if (bad) return await fail('probe-failed', bad)
      // Datos de una actualización de imagen (o de un intento anterior cortado): se restauran antes de dar `ready`.
      const backup = win32.join(p.installDir, WSL_HOME_BACKUP_NAME)
      const bst = await fs.lstat(backup).catch(() => null)
      let restored = false
      if (bst && !bst.isSymbolicLink() && bst.isFile()) {
        ctx.progress(97, 'checking')
        const r = await deps
          .runWithInput({ kind: 'import-home' }, fs.readStream(backup), WSL_HOME_TIMEOUT_MS)
          .catch((): RunResult => ({ code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: 'throw' }))
        if (!ok(r)) return await fail('home-restore-failed')
        restored = true
      }
      // Paso 11.
      ctx.progress(99, 'checking')
      const t = await safeRun({ kind: 'terminate' }, TERMINATE_MS)
      if (!ok(t)) deps.log('terminate no terminó bien (la VM se apaga sola al estar inactiva)')
      try {
        await writeState(p, {
          rootfsVersion: pin.rootfs.version,
          rootfsSha: pin.rootfs.sha256,
          payloadSha: art.payload.payloadSha,
          importedAt: new Date(deps.now()).toISOString()
        })
      } catch {
        return await fail('state-failed')
      }
      if (restored) await fs.rm(backup).catch(() => deps.log('no se pudo borrar el respaldo de datos'))
      await fs.rm(tar).catch(() => undefined)
      await fs.rm(art.opencodePath).catch(() => undefined)
      ctx.progress(100, 'done')
    } catch (e) {
      if (e instanceof WslSetupError) throw e
      await rollback(p, 'excepción inesperada')
      throw new WslSetupError('io', String((e as Error)?.message ?? e))
    }
  }

  // ── flujos ──

  const fullInstall = async (ctx: Ctx): Promise<void> => {
    await checkSpace(ctx.p, WSL_MIN_FREE_BYTES)
    const art = await acquire(ctx, true)
    await createDistro(ctx, art, true)
  }

  /** Reparar o actualizar la carga: sin reimportar y sin desregistrar jamás (el instalador es atómico). */
  const payloadUpdate = async (ctx: Ctx): Promise<void> => {
    // `broken:payload` también lo da una distro ajena sin lanzador: solo se repara si el estado lo escribimos nosotros.
    if (!(await stateExists(ctx.p))) throw new WslSetupError('foreign', 'no-state')
    await checkSpace(ctx.p, ctx.pin.opencode.size * 2 + WSL_PAYLOAD_FREE_MARGIN)
    const art = await acquire(ctx, false)
    ctx.progress(70, 'installing')
    if (!(await installPayload(art))) throw new WslSetupError('payload-failed')
    ctx.progress(95, 'checking')
    const list = await safeRun({ kind: 'list' }, LIST_MS)
    const bad = await probeReady(ctx, art, list)
    if (bad) throw new WslSetupError('probe-failed', bad)
    ctx.progress(99, 'checking')
    const t = await safeRun({ kind: 'terminate' }, TERMINATE_MS)
    if (!ok(t)) deps.log('terminate no terminó bien')
    let prev: Partial<WslSetupState> = {}
    try {
      prev = JSON.parse((await fs.readFile(ctx.p.statePath)).toString('utf8')) as Partial<WslSetupState>
    } catch {
      /* se reescribe entero */
    }
    try {
      await writeState(ctx.p, {
        rootfsVersion: ctx.pin.rootfs.version,
        rootfsSha: prev.rootfsSha ?? ctx.pin.rootfs.sha256,
        payloadSha: art.payload.payloadSha,
        importedAt: prev.importedAt ?? new Date(deps.now()).toISOString()
      })
    } catch {
      throw new WslSetupError('state-failed')
    }
    await fs.rm(art.opencodePath).catch(() => undefined)
    ctx.progress(100, 'done')
  }

  /** Imagen nueva: descarga ANTES de tocar nada, `--export-home`, quitar la distro vieja (el respaldo se queda), instalar y restaurar. */
  const imageUpdate = async (ctx: Ctx): Promise<void> => {
    const { p } = ctx
    if (!(await stateExists(p))) throw new WslSetupError('foreign', 'no-state')
    await checkSpace(p, WSL_MIN_FREE_BYTES)
    const art = await acquire(ctx, true)
    if ((await checkInstallDir(p)) === 'missing') throw new WslSetupError('bad-installdir', 'missing')
    const backup = win32.join(p.installDir, WSL_HOME_BACKUP_NAME)
    ctx.progress(70, 'creating')
    const exp = await deps
      .runToFile({ kind: 'export-home' }, backup, WSL_HOME_TIMEOUT_MS)
      .catch((): RunResult => ({ code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), error: 'throw' }))
    const bst = ok(exp) ? await fs.lstat(backup).catch(() => null) : null
    if (!bst || !bst.isFile() || bst.isSymbolicLink() || bst.size <= 0) {
      await cleanInstallDir(p, [WSL_HOME_BACKUP_NAME]) // la distro vieja sigue intacta
      throw new WslSetupError('backup-failed')
    }
    abortCheck(ctx) // último punto de cancelación: después se quita la distro vieja
    await safeRun({ kind: 'terminate' }, TERMINATE_MS)
    const u = await safeRun({ kind: 'unregister' }, UNREGISTER_MS)
    if (!ok(u)) {
      const l = await safeRun({ kind: 'list' }, LIST_MS)
      if (ok(l) && parseDistroList(decodeWslOutput(l.stdout)).some((d) => d.name === WSL_DISTRO)) {
        await cleanInstallDir(p, [WSL_HOME_BACKUP_NAME])
        throw new WslSetupError('unregister-failed')
      }
    }
    await cleanInstallDir(p, [WSL_VHDX_NAME]) // el respaldo NO se borra
    await fs.rm(p.statePath).catch(() => undefined)
    await createDistro({ ...ctx, signal: undefined }, art, false)
  }

  // ── API ──

  const setup = async (onProgress: ProgressFn, opts: WslSetupOptions = {}): Promise<void> => {
    if (deps.platform !== 'win32') throw new WslSetupError('unsupported')
    const p = wslSetupPaths(deps.localAppData)
    const pin = deps.pin()
    if (!pin) throw new WslSetupError('no-pin')
    const progress = monotonic(onProgress)
    await withLock(p, async () => {
      if (opts.signal?.aborted) throw new WslSetupError('aborted')
      const { status, version } = await readStatus()
      const ctx: Ctx = { p, pin, progress, signal: opts.signal, version }
      const detail = status.detail ?? ''
      if (status.state === 'ready') {
        progress(100, 'done')
        return
      }
      if (status.state === 'needsSetup') {
        if (detail.startsWith('update:payload')) return payloadUpdate(ctx)
        if (detail.startsWith('update:rootfs')) return imageUpdate(ctx)
        return fullInstall(ctx)
      }
      if (status.state === 'broken' && detail === 'payload') return payloadUpdate(ctx)
      throw new WslSetupError('blocked', `${status.state}${detail ? `:${detail}` : ''}`)
    })
  }

  const remove = async (): Promise<void> => {
    if (deps.platform !== 'win32') throw new WslSetupError('unsupported')
    const p = wslSetupPaths(deps.localAppData)
    await withLock(p, async () => {
      const list = await safeRun({ kind: 'list' }, LIST_MS)
      const registered = (r: RunResult): boolean => ok(r) && parseDistroList(decodeWslOutput(r.stdout)).some((d) => d.name === WSL_DISTRO)
      if (registered(list)) {
        await safeRun({ kind: 'terminate' }, TERMINATE_MS)
        const u = await safeRun({ kind: 'unregister' }, UNREGISTER_MS)
        if (!ok(u) && registered(await safeRun({ kind: 'list' }, LIST_MS))) throw new WslSetupError('unregister-failed')
      }
      let reparse = false
      try {
        await checkInstallDir(p)
      } catch {
        reparse = true
      }
      if (!reparse) await cleanInstallDir(p, [WSL_VHDX_NAME, WSL_HOME_BACKUP_NAME, `${WSL_HOME_BACKUP_NAME}.part`])
      await cleanCache(p)
      await fs.rm(p.statePath).catch(() => undefined)
      await fs.rm(`${p.statePath}.tmp`).catch(() => undefined)
      if (reparse) throw new WslSetupError('bad-installdir', 'reparse')
    })
  }

  return { setup, remove, expected, status: async () => (await readStatus()).status }
}
