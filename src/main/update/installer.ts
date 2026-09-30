import { createHash } from 'node:crypto'
import { constants as FS, createWriteStream } from 'node:fs'
import { access, lstat, mkdir, readdir, readlink, realpath, rm, statfs } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { dirname, join, resolve, sep } from 'node:path'
import {
  APP_BUNDLE_NAME,
  IDLE_INSTALL,
  MANIFEST_MAX_BYTES,
  MANIFEST_NAME,
  MANIFEST_SIG_NAME,
  MAX_REDIRECTS,
  SIGNATURE_MAX_BYTES,
  ZIP_MAX_BYTES,
  isAllowedDownloadUrl,
  isSafeZipEntry,
  parseManifest,
  reduceInstall,
  validateManifest,
  type InstallErrorCode,
  type InstallEvent,
  type InstallState,
  type UpdateManifest
} from '@shared/update-install'
import { verifyWithKeys, type UpdateKey } from './signature'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export interface RunResult {
  code: number
  stdout: string
  stderr: string
}
/** Ejecuta un binario con argumentos (NUNCA por una shell). */
export type RunFn = (cmd: string, args: string[]) => Promise<RunResult>

export interface FileKind {
  isFile: boolean
  isDirectory: boolean
  isSymlink: boolean
}
export interface WriteHandle {
  write(chunk: Uint8Array): Promise<void>
  close(): Promise<void>
}
/** Acceso a disco que usa el instalador (inyectable en tests). */
export interface InstallerFs {
  mkdirp(path: string, mode: number): Promise<void>
  rmrf(path: string): Promise<void>
  openWrite(path: string): Promise<WriteHandle>
  lstat(path: string): Promise<FileKind>
  readdir(path: string): Promise<string[]>
  readlink(path: string): Promise<string>
  realpath(path: string): Promise<string>
  freeBytes(path: string): Promise<number>
}

export class InstallError extends Error {
  constructor(
    readonly code: InstallErrorCode,
    message: string
  ) {
    super(message)
  }
}

export interface InstallerDeps {
  fetch: FetchLike
  run: RunFn
  fs: InstallerFs
  /** Carpeta de usuario de la app; el staging vive en `<userData>/update/staging/<versión>/`. */
  userData: string
  appId: string
  currentVersion: string
  repo: string
  /** `https://github.com` (en tests: el servidor local). */
  downloadBase: string
  allowLoopbackHttp: boolean
  keys: readonly UpdateKey[]
  userAgent: string
  onState: (s: InstallState) => void
  /** Corta la descarga si no llega ni un byte en este tiempo. */
  idleMs?: number
}

export interface ReadyUpdate {
  version: string
  tag: string
  manifest: UpdateManifest
  /** Ruta de la .app ya verificada, dentro del staging. */
  stagedApp: string
}

const UNCOMPRESSED_FACTOR_LIMIT = 3
const MAX_ENTRIES = 200_000

export function stagingRoot(userData: string): string {
  return join(userData, 'update', 'staging')
}

export class UpdateInstaller {
  private state: InstallState = IDLE_INSTALL
  private ready: ReadyUpdate | null = null
  private abort: AbortController | null = null
  private cancelled = false
  private running: Promise<void> | null = null

  constructor(private readonly d: InstallerDeps) {}

  getState(): InstallState {
    return this.state
  }

  getReady(): ReadyUpdate | null {
    return this.state.phase === 'ready' ? this.ready : null
  }

  private emit(e: InstallEvent): void {
    const next = reduceInstall(this.state, e)
    if (next === this.state) return
    this.state = next
    this.d.onState(next)
  }

  /** Descarga y verifica la versión indicada (la que el aviso ya conoce). No ejecuta nada del staging. */
  download(release: { version: string; tag: string }): Promise<void> {
    if (this.running) return this.running
    const before = this.state.phase
    if (before !== 'idle' && before !== 'error' && before !== 'cancelled') return Promise.resolve()
    this.cancelled = false
    this.ready = null
    this.abort = new AbortController()
    this.emit({ type: 'start', version: release.version })
    const p = this.run(release)
      .catch((err: unknown) => {
        if (this.cancelled) return
        const code = err instanceof InstallError ? err.code : 'unknown'
        console.warn(`[update] descarga fallida (${code}): ${err instanceof Error ? err.message : String(err)}`)
        this.emit({ type: 'fail', code })
        void this.d.fs.rmrf(join(stagingRoot(this.d.userData), release.version)).catch(() => undefined)
      })
      .finally(() => {
        this.running = null
        this.abort = null
      })
    this.running = p
    return p
  }

  cancel(): void {
    if (this.state.phase !== 'downloading' && this.state.phase !== 'verifying') return
    this.cancelled = true
    this.abort?.abort()
    this.emit({ type: 'cancel' })
    const v = this.state.version
    if (v) {
      const dir = join(stagingRoot(this.d.userData), v)
      void (this.running ?? Promise.resolve()).finally(() => this.d.fs.rmrf(dir).catch(() => undefined))
    }
  }

  /** Descarta una actualización ya lista o con error (vuelve a «idle»). */
  reset(): void {
    if (this.state.phase === 'ready') {
      const v = this.state.version
      this.ready = null
      if (v) void this.d.fs.rmrf(join(stagingRoot(this.d.userData), v)).catch(() => undefined)
    }
    this.emit({ type: 'reset' })
  }

  /**
   * Justo antes de sustituir: vuelve a verificar la .app del staging (recorrido, firma, Info.plist) y
   * pasa a «installing». Devuelve lo que necesita `swap.ts`.
   */
  async beginInstall(): Promise<ReadyUpdate> {
    const r = this.getReady()
    if (!r) throw new InstallError('install', 'no hay una actualización lista')
    try {
      await this.verifyApp(r.stagedApp, r.manifest)
    } catch (err) {
      this.emit({ type: 'install' })
      this.emit({ type: 'fail', code: err instanceof InstallError ? err.code : 'unknown' })
      throw err
    }
    this.emit({ type: 'install' })
    return r
  }

  markRestarting(): void {
    this.emit({ type: 'restarting' })
  }

  fail(code: InstallErrorCode): void {
    if (this.state.phase === 'ready') this.emit({ type: 'install' })
    this.emit({ type: 'fail', code })
  }

  // ---- descarga ----------------------------------------------------------------------------

  private async run(release: { version: string; tag: string }): Promise<void> {
    const { d } = this
    const signal = (this.abort as AbortController).signal
    const dir = join(stagingRoot(d.userData), release.version)
    await d.fs.rmrf(dir)
    await d.fs.mkdirp(dir, 0o700)

    const base = `${d.downloadBase.replace(/\/+$/, '')}/${d.repo}/releases/download/${encodeURIComponent(release.tag)}`
    const manifestBytes = await this.fetchSmall(`${base}/${MANIFEST_NAME}`, MANIFEST_MAX_BYTES, signal)
    const sigBytes = await this.fetchSmall(`${base}/${MANIFEST_SIG_NAME}`, SIGNATURE_MAX_BYTES, signal)

    // 1. La firma manda: primero se verifica sobre los bytes exactos y solo después se interpreta el JSON.
    const keyId = verifyWithKeys(manifestBytes, sigBytes.toString('utf8'), d.keys)
    if (keyId === null) throw new InstallError('signature', 'firma del manifiesto no válida')
    let manifest: UpdateManifest | null = null
    try {
      manifest = parseManifest(JSON.parse(manifestBytes.toString('utf8')))
    } catch {
      manifest = null
    }
    if (!manifest) throw new InstallError('manifest', 'manifiesto con forma no válida')
    const check = validateManifest(manifest, { appId: d.appId, current: d.currentVersion, tag: release.tag, keyId })
    if (!check.ok) throw new InstallError(check.code, check.reason)
    if (manifest.version !== release.version) throw new InstallError('manifest', 'la versión no es la del aviso')

    // 2. Espacio libre (ZIP + extracción + copia ≈ 3× el tamaño).
    const free = await d.fs.freeBytes(dir)
    if (free < manifest.zip.size * UNCOMPRESSED_FACTOR_LIMIT) throw new InstallError('space', 'espacio insuficiente')

    // 3. ZIP: tamaño firmado como tope real de lectura + hash incremental.
    const zipPath = join(dir, manifest.zip.name)
    await this.downloadZip(`${base}/${manifest.zip.name}`, manifest, zipPath, signal)
    if (this.cancelled) return

    // 4. Verificación; nada del staging se ejecuta antes de «installing».
    this.emit({ type: 'verifying' })
    const stagedApp = await this.extractAndVerify(zipPath, dir, manifest)
    if (this.cancelled) return
    this.ready = { version: manifest.version, tag: manifest.tag, manifest, stagedApp }
    this.emit({ type: 'ready' })
  }

  /** GET con redirecciones a mano: ≤3 saltos, solo hosts permitidos, sin credenciales. */
  private async fetchFollow(url: string, signal: AbortSignal, idle: { touch(): void; signal: AbortSignal }): Promise<Response> {
    let current = url
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isAllowedDownloadUrl(current, this.d.allowLoopbackHttp)) throw new InstallError('network', 'destino de descarga no permitido')
      idle.touch()
      let res: Response
      try {
        res = await this.d.fetch(current, {
          method: 'GET',
          headers: { Accept: 'application/octet-stream', 'User-Agent': this.d.userAgent },
          redirect: 'manual',
          credentials: 'omit',
          signal: AbortSignal.any([signal, idle.signal])
        })
      } catch (err) {
        throw new InstallError('network', err instanceof Error ? err.message : 'sin conexión')
      }
      if ([301, 302, 303, 307, 308].includes(res.status)) {
        const loc = res.headers.get('location')
        await res.body?.cancel().catch(() => undefined)
        if (!loc) throw new InstallError('network', 'redirección sin destino')
        try {
          current = new URL(loc, current).href
        } catch {
          throw new InstallError('network', 'redirección no válida')
        }
        continue
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => undefined)
        throw new InstallError('network', `HTTP ${res.status}`)
      }
      return res
    }
    throw new InstallError('network', 'demasiadas redirecciones')
  }

  private idleGuard(): { touch(): void; signal: AbortSignal; stop(): void } {
    const ctl = new AbortController()
    const ms = this.d.idleMs ?? 30_000
    let t: ReturnType<typeof setTimeout> | null = null
    const touch = (): void => {
      if (t) clearTimeout(t)
      t = setTimeout(() => ctl.abort(), ms)
      t.unref?.()
    }
    return {
      touch,
      signal: ctl.signal,
      stop: () => {
        if (t) clearTimeout(t)
      }
    }
  }

  private async fetchSmall(url: string, max: number, signal: AbortSignal): Promise<Buffer> {
    const idle = this.idleGuard()
    try {
      const res = await this.fetchFollow(url, signal, idle)
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > max) throw new InstallError('manifest', 'respuesta demasiado grande')
      const reader = res.body?.getReader()
      if (!reader) throw new InstallError('manifest', 'respuesta vacía')
      const chunks: Uint8Array[] = []
      let total = 0
      try {
        for (;;) {
          idle.touch()
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > max) {
            await reader.cancel().catch(() => undefined)
            throw new InstallError('manifest', 'respuesta demasiado grande')
          }
          chunks.push(value)
        }
      } catch (err) {
        if (err instanceof InstallError) throw err
        throw new InstallError('network', 'lectura interrumpida')
      }
      if (total === 0) throw new InstallError('manifest', 'respuesta vacía')
      return Buffer.concat(chunks)
    } finally {
      idle.stop()
    }
  }

  private async downloadZip(url: string, m: UpdateManifest, dest: string, signal: AbortSignal): Promise<void> {
    const size = Math.min(m.zip.size, ZIP_MAX_BYTES)
    const idle = this.idleGuard()
    const hash = createHash('sha256')
    let out: WriteHandle | null = null
    try {
      const res = await this.fetchFollow(url, signal, idle)
      const declared = Number(res.headers.get('content-length'))
      if (Number.isFinite(declared) && res.headers.has('content-length') && declared !== size)
        throw new InstallError('size', 'tamaño declarado distinto del firmado')
      const reader = res.body?.getReader()
      if (!reader) throw new InstallError('network', 'respuesta vacía')
      out = await this.d.fs.openWrite(dest)
      let received = 0
      let lastPct = -1
      try {
        for (;;) {
          idle.touch()
          const { done, value } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > size) {
            await reader.cancel().catch(() => undefined)
            throw new InstallError('size', 'la descarga supera el tamaño firmado')
          }
          hash.update(value)
          await out.write(value)
          const pct = Math.floor((received / size) * 100)
          if (pct !== lastPct) {
            lastPct = pct
            this.emit({ type: 'progress', received, total: size })
          }
        }
      } catch (err) {
        if (err instanceof InstallError) throw err
        throw new InstallError('network', 'descarga interrumpida')
      }
      if (received !== size) throw new InstallError('size', 'descarga incompleta')
      if (hash.digest('hex') !== m.zip.sha256) throw new InstallError('hash', 'SHA-256 distinto del firmado')
    } finally {
      idle.stop()
      await out?.close().catch(() => undefined)
    }
  }

  // ---- verificación ------------------------------------------------------------------------

  private async extractAndVerify(zipPath: string, dir: string, m: UpdateManifest): Promise<string> {
    const { run } = this.d
    // 2. Listado con zipinfo: cada entrada validada ANTES de extraer nada.
    const list = await run('/usr/bin/zipinfo', ['-1', zipPath])
    if (list.code !== 0) throw new InstallError('zip', 'no se pudo listar el ZIP')
    const entries = list.stdout.split('\n').filter((l) => l.length > 0)
    if (entries.length === 0 || entries.length > MAX_ENTRIES) throw new InstallError('zip', 'listado del ZIP no válido')
    for (const e of entries)
      if (!isSafeZipEntry(e)) throw new InstallError('zip', `entrada no permitida: ${JSON.stringify(e.slice(0, 80))}`)
    // Tope de tamaño descomprimido (ZIP bomba): el espacio comprobado alcanza para 3× el ZIP.
    const totals = await run('/usr/bin/zipinfo', ['-t', zipPath])
    const uncompressed = /(\d+) bytes uncompressed/.exec(totals.stdout)?.[1]
    if (totals.code !== 0 || !uncompressed) throw new InstallError('zip', 'no se pudo medir el ZIP')
    if (Number(uncompressed) > m.zip.size * UNCOMPRESSED_FACTOR_LIMIT + 1024 * 1024 * 1024)
      throw new InstallError('zip', 'el ZIP se expande demasiado')
    if (this.cancelled) throw new InstallError('unknown', 'cancelado')

    // 3. Extracción con ditto en una carpeta propia del staging.
    const extractDir = join(dir, 'extract')
    await this.d.fs.mkdirp(extractDir, 0o700)
    const ex = await run('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir])
    if (ex.code !== 0) throw new InstallError('zip', 'no se pudo extraer el ZIP')
    const app = join(extractDir, APP_BUNDLE_NAME)
    await this.verifyApp(app, m)
    // 8. La app descargada no debe llevar cuarentena.
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', app])
    return app
  }

  /** Pasos 4 a 7: recorrido lstat, `codesign --verify`, identificador de firma y Info.plist. */
  async verifyApp(app: string, m: UpdateManifest): Promise<void> {
    const { run } = this.d
    const st = await this.d.fs.lstat(app).catch(() => null)
    if (!st || !st.isDirectory || st.isSymlink) throw new InstallError('zip', 'falta OnyxCode.app')
    await this.walk(app)

    const cs = await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app])
    if (cs.code !== 0) throw new InstallError('signing', 'la firma del paquete no es coherente')
    const dv = await run('/usr/bin/codesign', ['-dv', app])
    const ident = /^Identifier=(.*)$/m.exec(`${dv.stderr}\n${dv.stdout}`)?.[1]?.trim()
    if (dv.code !== 0 || ident !== this.d.appId) throw new InstallError('signing', 'identificador de firma distinto')

    const plist = join(app, 'Contents', 'Info.plist')
    const id = await run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plist])
    const ver = await run('/usr/bin/plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', plist])
    if (id.code !== 0 || id.stdout.trim() !== m.appId) throw new InstallError('signing', 'Info.plist: identificador distinto')
    if (ver.code !== 0 || ver.stdout.trim() !== m.version) throw new InstallError('downgrade', 'Info.plist: versión distinta de la firmada')
  }

  /** Todo symlink debe resolverse dentro de la .app; nada de dispositivos, FIFOs ni sockets. */
  private async walk(root: string): Promise<void> {
    const realRoot = await this.d.fs.realpath(root)
    const inside = (p: string): boolean => p === realRoot || p.startsWith(realRoot + sep)
    const visit = async (dir: string): Promise<void> => {
      for (const name of await this.d.fs.readdir(dir)) {
        const p = join(dir, name)
        const k = await this.d.fs.lstat(p)
        if (k.isSymlink) {
          const target = await this.d.fs.readlink(p)
          if (target.startsWith('/') || target.includes('\0')) throw new InstallError('zip', `symlink absoluto: ${name}`)
          let real: string
          try {
            real = await this.d.fs.realpath(p)
          } catch {
            // Enlace colgante: se resuelve a mano desde la carpeta real que lo contiene.
            real = resolve(await this.d.fs.realpath(dirname(p)), target)
          }
          if (!inside(real)) throw new InstallError('zip', `symlink fuera de la app: ${name}`)
        } else if (k.isDirectory) await visit(p)
        else if (!k.isFile) throw new InstallError('zip', `tipo de archivo no permitido: ${name}`)
      }
    }
    await visit(root)
  }
}

// ---- implementaciones reales ---------------------------------------------------------------

export function nodeInstallerFs(): InstallerFs {
  return {
    mkdirp: async (p, mode) => void (await mkdir(p, { recursive: true, mode })),
    rmrf: (p) => rm(p, { recursive: true, force: true }),
    openWrite: async (p) => {
      const ws = createWriteStream(p, { flags: 'wx', mode: 0o600 })
      await new Promise<void>((ok, ko) => {
        ws.once('open', () => ok())
        ws.once('error', ko)
      })
      return {
        write: (chunk) =>
          new Promise<void>((ok, ko) => {
            ws.write(chunk, (e) => (e ? ko(e) : ok()))
          }),
        close: () => new Promise<void>((ok) => ws.end(() => ok()))
      }
    },
    lstat: async (p) => {
      const s = await lstat(p)
      return { isFile: s.isFile(), isDirectory: s.isDirectory(), isSymlink: s.isSymbolicLink() }
    },
    readdir: (p) => readdir(p),
    readlink: (p) => readlink(p),
    realpath: (p) => realpath(p),
    freeBytes: async (p) => {
      const s = await statfs(p)
      return Number(s.bavail) * Number(s.bsize)
    }
  }
}

/** Comprueba permiso de escritura (para validar el lugar de instalación). */
export async function canWrite(p: string): Promise<boolean> {
  try {
    await access(p, FS.W_OK)
    return true
  } catch {
    return false
  }
}

export const nodeRun: RunFn = (cmd, args) =>
  new Promise((ok) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (b: Buffer) => (stdout = (stdout + b.toString('utf8')).slice(-8 * 1024 * 1024)))
    child.stderr.on('data', (b: Buffer) => (stderr = (stderr + b.toString('utf8')).slice(-64 * 1024)))
    child.once('error', (e) => ok({ code: 127, stdout, stderr: `${stderr}${e.message}` }))
    child.once('close', (code) => ok({ code: code ?? 1, stdout, stderr }))
  })
