/**
 * Binario de `cloudflared` para el modo viaje: descarga BAJO DEMANDA, con consentimiento, de la release oficial de GitHub y
 * verificación estricta. Nunca se ejecuta nada sin verificar.
 *
 * El pin (`resources/cloudflared/pin.json`, compilado dentro del código firmado de la app) guarda DOS hashes: el del `.tgz`
 * descargado y el del binario extraído (en la release oficial el cuerpo publica el del binario y la API el del `.tgz`), el tamaño
 * exacto y la firma esperada (Developer ID de Cloudflare Inc., equipo `68WVV388M8`).
 *
 * Instalar: consentimiento explícito → política `allowTravelDownload` → descarga solo de una lista cerrada de hosts (redirecciones
 * comprobadas una a una; tope de bytes exacto; SHA-256 en flujo) → `tar -tzf` debe listar UN solo archivo llamado `cloudflared` →
 * extracción a una carpeta nueva → un único archivo regular (sin enlaces) con tamaño y SHA-256 del pin → `codesign` (cadena Developer ID
 * y equipo) → `chmod 0700` y renombrado atómico a `<bin>/cloudflared-<versión>/cloudflared`.
 * Arrancar: `ensureReady()` vuelve a comprobar el hash y la firma ANTES de CADA arranque.
 */
import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
  createReadStream
} from 'node:fs'
import { join } from 'node:path'
import type { TravelBinaryState } from '@shared/remote/travel'
import type { AuditInput } from '../audit'

export interface PinSignature {
  identifier: string
  teamId: string
  authority: string
}
export interface PinAsset {
  url: string
  /** Bytes exactos del `.tgz`. */
  size: number
  /** SHA-256 del `.tgz`. */
  sha256: string
  /** Bytes exactos del binario extraído. */
  binSize: number
  /** SHA-256 del binario extraído. */
  binSha256: string
  binMaxSize: number
  signature: PinSignature
}
export interface CloudflaredPin {
  version: string
  releasedAt: string
  assets: Record<string, PinAsset>
}

const HEX64 = /^[0-9a-f]{64}$/
const RELEASE_URL_RE = /^https:\/\/github\.com\/cloudflare\/cloudflared\/releases\/download\/[0-9A-Za-z._-]+\/[0-9A-Za-z._-]+\.tgz$/
const VERSION_RE = /^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}$/
const TEAM_RE = /^[A-Z0-9]{10}$/
const posInt = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max

/** Valida el pin entero (forma estricta). `null` = no es fiable: el modo viaje no puede instalar ni arrancar. */
export function parsePin(raw: unknown): CloudflaredPin | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.version !== 'string' || !VERSION_RE.test(o.version)) return null
  if (typeof o.releasedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.releasedAt)) return null
  if (!o.assets || typeof o.assets !== 'object' || Array.isArray(o.assets)) return null
  const assets: Record<string, PinAsset> = {}
  for (const [key, v] of Object.entries(o.assets as Record<string, unknown>)) {
    if (!/^(darwin|win32|linux)-(arm64|x64)$/.test(key) || !v || typeof v !== 'object') return null
    const a = v as Record<string, unknown>
    const sig = a.signature as Record<string, unknown> | undefined
    if (
      typeof a.url !== 'string' ||
      !RELEASE_URL_RE.test(a.url) ||
      !a.url.includes(`/download/${o.version}/`) ||
      !posInt(a.size, 200_000_000) ||
      typeof a.sha256 !== 'string' ||
      !HEX64.test(a.sha256) ||
      !posInt(a.binSize, 200_000_000) ||
      typeof a.binSha256 !== 'string' ||
      !HEX64.test(a.binSha256) ||
      !posInt(a.binMaxSize, 200_000_000) ||
      a.binSize > a.binMaxSize ||
      !sig ||
      typeof sig.identifier !== 'string' ||
      !/^[A-Za-z0-9._-]{1,64}$/.test(sig.identifier) ||
      typeof sig.teamId !== 'string' ||
      !TEAM_RE.test(sig.teamId) ||
      typeof sig.authority !== 'string' ||
      !sig.authority.includes(`(${sig.teamId})`)
    )
      return null
    assets[key] = {
      url: a.url,
      size: a.size,
      sha256: a.sha256,
      binSize: a.binSize,
      binSha256: a.binSha256,
      binMaxSize: a.binMaxSize,
      signature: { identifier: sig.identifier, teamId: sig.teamId, authority: sig.authority }
    }
  }
  return { version: o.version, releasedAt: o.releasedAt, assets }
}

export function pinFor(pin: CloudflaredPin | null, platform: string = process.platform, arch: string = process.arch): PinAsset | null {
  return pin?.assets[`${platform}-${arch}`] ?? null
}

/** Meses desde `releasedAt`: con más de 10 Ajustes avisa «actualiza Lazunox» (Cloudflare solo da soporte a versiones de < 1 año). */
export function pinAgeMonths(pin: CloudflaredPin, now: number = Date.now()): number {
  return (now - Date.parse(`${pin.releasedAt}T00:00:00Z`)) / (30.4375 * 86_400_000)
}

/** Hosts desde los que se admite la descarga (lista cerrada; cualquier otro, incluso por redirección, es un fallo). */
export const DOWNLOAD_HOSTS: readonly string[] = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']
const MAX_REDIRECTS = 5
const DOWNLOAD_PATH_PREFIX = '/cloudflare/cloudflared/releases/download/'

export type BinaryErrorCode =
  'policy' | 'consent' | 'unsupported' | 'bad-hash' | 'bad-signature' | 'download' | 'extract' | 'busy' | 'no-binary'
export class BinaryError extends Error {
  constructor(readonly code: BinaryErrorCode) {
    super(code)
  }
}

export interface RunResult {
  stdout: string
  stderr: string
}
/** `execFile` sin shell (argumentos fijos). Inyectable para las pruebas. */
export type RunFile = (file: string, args: string[], opts?: { timeoutMs?: number }) => Promise<RunResult>

export const realRun: RunFile = (file, args, opts) =>
  new Promise((resolve, reject) => {
    execFile(file, args, { timeout: opts?.timeoutMs ?? 30_000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) reject(Object.assign(err, { stdout, stderr }))
      else resolve({ stdout, stderr })
    })
  })

/** Subconjunto de `fetch` que se usa (en producción, `net.fetch` de Electron: respeta el proxy del sistema). */
export type FetchLike = (url: string, init: { signal?: AbortSignal; redirect: 'manual' }) => Promise<Response>

export interface BinaryOptions {
  pin: CloudflaredPin | null
  /** Carpeta `userData/bin` (se crea con 0700). */
  binDir: string
  platform?: string
  arch?: string
  fetch?: FetchLike
  run?: RunFile
  /** Política `allowTravelDownload` (por defecto, sí). */
  allowDownload?: () => boolean
  audit?: (e: AuditInput) => void
}

export interface InstallOptions {
  /** DEBE ser `true` (diálogo del Mac). Sin él no hay ninguna petición de red. */
  consent: boolean
  onProgress?: (done: number, total: number) => void
  signal?: AbortSignal
}

/** SHA-256 de un archivo en flujo. */
export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(path)
    s.on('data', (c) => h.update(c))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

/** Requisito de código: identificador + cadena Developer ID de Apple + equipo de Cloudflare. */
export function codesignRequirement(sig: PinSignature): string {
  return (
    `identifier "${sig.identifier}" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists` +
    ` and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${sig.teamId}"`
  )
}

/** Extrae `TeamIdentifier`, `Identifier` y `Authority` de la salida de `codesign -d --verbose=2`. */
export function parseCodesignDetails(out: string): { identifier: string | null; teamId: string | null; authorities: string[] } {
  const grab = (k: string): string | null => new RegExp(`^${k}=(.+)$`, 'm').exec(out)?.[1]?.trim() ?? null
  const authorities = [...out.matchAll(/^Authority=(.+)$/gm)].map((m) => m[1].trim())
  return { identifier: grab('Identifier'), teamId: grab('TeamIdentifier'), authorities }
}

export class CloudflaredBinary {
  private installing: Promise<string> | null = null
  private readonly platform: string
  private readonly arch: string
  private readonly run: RunFile
  /** Un hash que no casó (sticky hasta reinstalar): lo ve Ajustes como `bad-hash`. */
  private badHash = false

  constructor(private readonly o: BinaryOptions) {
    this.platform = o.platform ?? process.platform
    this.arch = o.arch ?? process.arch
    this.run = o.run ?? realRun
  }

  get pin(): CloudflaredPin | null {
    return this.o.pin
  }

  asset(): PinAsset | null {
    return pinFor(this.o.pin, this.platform, this.arch)
  }

  private dirName(): string {
    return `cloudflared-${this.o.pin?.version ?? 'none'}`
  }

  /** `<bin>/cloudflared-<versión>/cloudflared` (ruta fija que reconoce `killStaleServers`). */
  installedPath(): string {
    return join(this.o.binDir, this.dirName(), 'cloudflared')
  }

  private otherVersions(): string[] {
    try {
      return readdirSync(this.o.binDir).filter((n) => /^cloudflared-[0-9A-Za-z._-]+$/.test(n) && n !== this.dirName())
    } catch {
      return []
    }
  }

  /** Estado barato (sin hashear 40 MB): para `getState()`. El hash completo se comprueba en `verifyInstalled`/`ensureReady`. */
  quickState(): TravelBinaryState {
    if (this.badHash) return 'bad-hash'
    try {
      const st = lstatSync(this.installedPath())
      if (st.isFile() && !st.isSymbolicLink()) return 'ready'
    } catch {
      /* no está */
    }
    return this.otherVersions().length > 0 ? 'outdated' : 'missing'
  }

  /** Comprobación completa del binario instalado (existencia, tipo, permisos, tamaño y SHA-256). Borra lo que no casa. */
  async verifyInstalled(): Promise<TravelBinaryState> {
    const a = this.asset()
    if (!a) return 'missing'
    const path = this.installedPath()
    let st
    try {
      st = lstatSync(path)
    } catch {
      return this.otherVersions().length > 0 ? 'outdated' : 'missing'
    }
    const bad = (): TravelBinaryState => {
      this.badHash = true
      this.o.audit?.({ kind: 'travel-binary-bad-hash' })
      rmSync(join(this.o.binDir, this.dirName()), { recursive: true, force: true })
      return 'bad-hash'
    }
    if (!st.isFile() || st.isSymbolicLink() || st.size > a.binMaxSize || st.size !== a.binSize) return bad()
    // Escritura para el grupo/otros: no es fiable (solo el dueño puede modificarlo).
    if (process.platform !== 'win32' && (st.mode & 0o022) !== 0) return bad()
    let hash: string
    try {
      hash = await sha256File(path)
    } catch {
      return 'missing'
    }
    if (hash !== a.binSha256) return bad()
    this.badHash = false
    return 'ready'
  }

  /**
   * Comprueba la firma (macOS): `codesign --verify --strict` con el requisito Developer ID del equipo fijado y, además, lee los
   * detalles para exigir `Identifier` y `TeamIdentifier`. Cualquier otra cosa = `false`.
   */
  async checkSignature(path: string): Promise<boolean> {
    const a = this.asset()
    if (!a || this.platform !== 'darwin') return false
    try {
      await this.run('/usr/bin/codesign', ['--verify', '--strict', `-R=${codesignRequirement(a.signature)}`, path])
      const det = await this.run('/usr/bin/codesign', ['-d', '--verbose=2', path])
      const d = parseCodesignDetails(`${det.stdout}\n${det.stderr}`)
      return d.identifier === a.signature.identifier && d.teamId === a.signature.teamId && d.authorities.includes(a.signature.authority)
    } catch {
      return false
    }
  }

  /** Antes de CADA arranque: hash + firma. Devuelve la ruta del binario, o lanza `BinaryError`. */
  async ensureReady(): Promise<string> {
    if (!this.asset()) throw new BinaryError('unsupported')
    const state = await this.verifyInstalled()
    if (state === 'bad-hash') throw new BinaryError('bad-hash')
    if (state !== 'ready') throw new BinaryError('no-binary')
    const path = this.installedPath()
    if (!(await this.checkSignature(path))) {
      this.badHash = true
      this.o.audit?.({ kind: 'travel-binary-bad-hash' })
      rmSync(join(this.o.binDir, this.dirName()), { recursive: true, force: true })
      throw new BinaryError('bad-signature')
    }
    return path
  }

  install(opts: InstallOptions): Promise<string> {
    if (this.installing) return Promise.reject(new BinaryError('busy'))
    this.installing = this.doInstall(opts).finally(() => {
      this.installing = null
    })
    return this.installing
  }

  get isInstalling(): boolean {
    return this.installing !== null
  }

  private async doInstall(opts: InstallOptions): Promise<string> {
    // 1) Sin consentimiento NO hay ninguna petición. 2) La política puede prohibir la descarga.
    if (opts.consent !== true) throw new BinaryError('consent')
    if (this.o.allowDownload && !this.o.allowDownload()) throw new BinaryError('policy')
    const a = this.asset()
    if (!a || !this.o.fetch || this.platform !== 'darwin') throw new BinaryError('unsupported')
    mkdirSync(this.o.binDir, { recursive: true, mode: 0o700 })
    try {
      chmodSync(this.o.binDir, 0o700)
    } catch {
      /* el umask manda */
    }
    const work = join(this.o.binDir, `.partial-${randomBytes(6).toString('hex')}`)
    mkdirSync(work, { mode: 0o700 })
    try {
      const tgz = join(work, 'cloudflared.tgz')
      await this.download(a, tgz, opts)
      const out = join(work, 'out')
      mkdirSync(out, { mode: 0o700 })
      await this.extract(tgz, out)
      const bin = join(out, 'cloudflared')
      const entries = readdirSync(out)
      const st = lstatSync(bin)
      if (entries.length !== 1 || entries[0] !== 'cloudflared' || !st.isFile() || st.isSymbolicLink()) throw new BinaryError('extract')
      if (st.size > a.binMaxSize || st.size !== a.binSize) throw new BinaryError('bad-hash')
      if ((await sha256File(bin)) !== a.binSha256) {
        this.o.audit?.({ kind: 'travel-binary-bad-hash' })
        throw new BinaryError('bad-hash')
      }
      chmodSync(bin, 0o700)
      // La firma se comprueba ANTES de dejarlo en su sitio.
      if (!(await this.checkSignature(bin))) {
        this.o.audit?.({ kind: 'travel-binary-bad-hash' })
        throw new BinaryError('bad-signature')
      }
      const dir = join(this.o.binDir, this.dirName())
      rmSync(dir, { recursive: true, force: true })
      mkdirSync(dir, { mode: 0o700 })
      renameSync(bin, join(dir, 'cloudflared'))
      for (const old of this.otherVersions()) rmSync(join(this.o.binDir, old), { recursive: true, force: true })
      this.badHash = false
      this.o.audit?.({ kind: 'travel-binary-installed', why: this.o.pin?.version })
      return this.installedPath()
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  }

  /** Descarga con lista cerrada de hosts, redirecciones una a una, tope de bytes exacto y SHA-256 en flujo. */
  private async download(a: PinAsset, dest: string, opts: InstallOptions): Promise<void> {
    const fetchFn = this.o.fetch as FetchLike
    let url = a.url
    let res: Response | null = null
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const u = new URL(url)
      if (u.protocol !== 'https:' || !DOWNLOAD_HOSTS.includes(u.hostname) || u.port !== '' || u.username || u.password)
        throw new BinaryError('download')
      if (hop === 0 && !u.pathname.startsWith(DOWNLOAD_PATH_PREFIX)) throw new BinaryError('download')
      try {
        res = await fetchFn(url, { signal: opts.signal, redirect: 'manual' })
      } catch {
        throw new BinaryError('download')
      }
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location')
        void res.body?.cancel().catch(() => undefined)
        if (!loc || hop === MAX_REDIRECTS) throw new BinaryError('download')
        try {
          url = new URL(loc, url).toString()
        } catch {
          throw new BinaryError('download')
        }
        res = null
        continue
      }
      break
    }
    if (!res || res.status !== 200 || !res.body) throw new BinaryError('download')
    const declared = Number(res.headers.get('content-length') ?? a.size)
    if (Number.isFinite(declared) && declared > a.size) {
      void res.body.cancel().catch(() => undefined)
      throw new BinaryError('download')
    }
    const hash = createHash('sha256')
    const fd = openSync(dest, 'wx', 0o600)
    let total = 0
    try {
      const reader = res.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > a.size) {
          void reader.cancel().catch(() => undefined)
          throw new BinaryError('download')
        }
        hash.update(value)
        writeSync(fd, value)
        opts.onProgress?.(total, a.size)
      }
    } catch (err) {
      if (err instanceof BinaryError) throw err
      throw new BinaryError('download')
    } finally {
      closeSync(fd)
    }
    if (total !== a.size || hash.digest('hex') !== a.sha256) {
      this.o.audit?.({ kind: 'travel-binary-bad-hash' })
      throw new BinaryError('bad-hash')
    }
  }

  /** `tar -tzf` debe listar UN solo archivo llamado `cloudflared` (sin rutas, `./`, `..` ni enlaces); luego se extrae solo ese. */
  private async extract(tgz: string, out: string): Promise<void> {
    try {
      const list = await this.run('/usr/bin/tar', ['-tzf', tgz])
      const names = list.stdout.split('\n').filter((l) => l !== '')
      if (names.length !== 1 || names[0] !== 'cloudflared') throw new BinaryError('extract')
      await this.run('/usr/bin/tar', ['-xzf', tgz, '-C', out, 'cloudflared'])
    } catch (err) {
      throw err instanceof BinaryError ? err : new BinaryError('extract')
    }
  }
}

/** ¿Existe el binario en la ruta? (atajo para pruebas y diagnóstico). */
export function binaryExists(b: CloudflaredBinary): boolean {
  return existsSync(b.installedPath())
}

/** Lectura cruda del pin desde una ruta (para pruebas y para el generador). */
export function readPinFile(path: string): CloudflaredPin | null {
  try {
    return parsePin(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}
