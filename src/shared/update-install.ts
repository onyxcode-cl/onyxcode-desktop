/**
 * Lógica pura (sin Electron ni Node) del actualizador propio: manifiesto firmado, validación
 * anti-downgrade, entradas seguras del ZIP, lugar de instalación y reductor de estados.
 * La AUTENTICIDAD la da solo la firma Ed25519 del manifiesto (src/main/update/signature.ts);
 * `codesign` solo comprueba integridad y coherencia del paquete.
 */
import { isNewerRelease, parseSemver, RELEASES_HOST } from './update-check'
import { t } from './i18n'

/** Nombre de la .app dentro del ZIP. */
export const APP_BUNDLE_NAME = 'Lazunox.app'
export const MANIFEST_NAME = 'update.json'
export const MANIFEST_SIG_NAME = 'update.json.sig'
export const MANIFEST_MAX_BYTES = 16 * 1024
export const SIGNATURE_MAX_BYTES = 1024
export const ZIP_MAX_BYTES = 600 * 1024 * 1024
export const PLATFORM = 'darwin-arm64'
export const MAX_REDIRECTS = 3

export type UpdatePlatformId = 'darwin-arm64' | 'win32-x64'

export interface UpdatePlatformSpec {
  id: UpdatePlatformId
  /** Asset del manifiesto firmado en la release. */
  manifestName: string
  /** Asset de la firma Ed25519 del manifiesto. */
  manifestSigName: string
  /** Nombre exacto del ZIP para una versión. */
  zipName: (version: string) => string
  zipRe: RegExp
  /** Raíz de todas las entradas del ZIP. */
  root: string
}

/** Plataformas con actualizador propio. `darwin-arm64` conserva sus constantes de siempre; `win32-x64` es nueva (sin uso en Mac). */
export const UPDATE_PLATFORMS: Readonly<Record<UpdatePlatformId, UpdatePlatformSpec>> = {
  'darwin-arm64': {
    id: 'darwin-arm64',
    manifestName: MANIFEST_NAME,
    manifestSigName: MANIFEST_SIG_NAME,
    zipName: (v) => `Lazunox-${v}-arm64.zip`,
    zipRe: /^Lazunox-\d+\.\d+\.\d+-arm64\.zip$/,
    root: APP_BUNDLE_NAME
  },
  'win32-x64': {
    id: 'win32-x64',
    manifestName: 'update-win32-x64.json',
    manifestSigName: 'update-win32-x64.json.sig',
    zipName: (v) => `Lazunox-${v}-win32-x64.zip`,
    zipRe: /^Lazunox-\d+\.\d+\.\d+-win32-x64\.zip$/,
    root: 'Lazunox/'
  }
}
const SHA256_RE = /^[0-9a-f]{64}$/

export interface UpdateManifest {
  schema: 1
  appId: string
  version: string
  tag: string
  platform: UpdatePlatformId
  keyId: string
  zip: { name: string; size: number; sha256: string }
  publishedAt: string
}

export type InstallErrorCode =
  | 'network'
  | 'manifest'
  | 'signature'
  | 'downgrade'
  | 'size'
  | 'hash'
  | 'zip'
  | 'signing'
  | 'space'
  | 'location'
  | 'rolled-back'
  | 'install'
  | 'unknown'

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/**
 * Interpreta el JSON YA verificado por firma. Devuelve null si la forma no es exactamente la esperada o si la plataforma
 * del manifiesto no es la pedida (por defecto el Mac: un manifiesto de Windows nunca se acepta ahí por descuido).
 */
export function parseManifest(json: unknown, expected: UpdatePlatformId = PLATFORM): UpdateManifest | null {
  if (!isObj(json) || json.schema !== 1) return null
  const { appId, version, tag, platform, keyId, zip, publishedAt } = json
  if (typeof appId !== 'string' || appId.length === 0 || appId.length > 128) return null
  if (typeof version !== 'string' || version.length > 64 || !parseSemver(version)) return null
  if (typeof tag !== 'string' || tag.length === 0 || tag.length > 128) return null
  if (platform !== expected) return null
  if (typeof keyId !== 'string' || keyId.length === 0 || keyId.length > 64) return null
  if (typeof publishedAt !== 'string' || publishedAt.length > 64 || !Number.isFinite(Date.parse(publishedAt))) return null
  if (!isObj(zip)) return null
  const { name, size, sha256 } = zip
  if (typeof name !== 'string' || typeof sha256 !== 'string') return null
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > ZIP_MAX_BYTES) return null
  if (!SHA256_RE.test(sha256)) return null
  return { schema: 1, appId, version, tag, platform: expected, keyId, zip: { name, size, sha256 }, publishedAt }
}

export interface ManifestContext {
  appId: string
  /** Versión instalada. */
  current: string
  /** Tag de la release de la que salió el manifiesto (p.ej. «v0.4.0»). */
  tag: string
  /** Identificador de la clave con la que verificó la firma. */
  keyId: string
}

export type ManifestCheck = { ok: true } | { ok: false; code: InstallErrorCode; reason: string }

export function validateManifest(m: UpdateManifest, ctx: ManifestContext): ManifestCheck {
  if (m.appId !== ctx.appId) return { ok: false, code: 'manifest', reason: 'appId distinto' }
  if (m.keyId !== ctx.keyId) return { ok: false, code: 'manifest', reason: 'keyId distinto' }
  if (m.tag !== ctx.tag) return { ok: false, code: 'manifest', reason: 'el tag no coincide con la release' } // i18n-ignore: motivo interno del registro, no se muestra
  if (m.version !== ctx.tag.replace(/^v/, '')) return { ok: false, code: 'manifest', reason: 'la versión no coincide con el tag' } // i18n-ignore: motivo interno del registro, no se muestra
  if (!isNewerRelease({ tag: m.version, prerelease: false, draft: false }, ctx.current)) {
    return { ok: false, code: 'downgrade', reason: 'la versión no es mayor que la instalada' } // i18n-ignore: motivo interno del registro, no se muestra
  }
  const spec = UPDATE_PLATFORMS[m.platform]
  if (!spec || !spec.zipRe.test(m.zip.name) || m.zip.name !== spec.zipName(m.version)) {
    return { ok: false, code: 'manifest', reason: 'nombre de ZIP no válido' } // i18n-ignore: motivo interno del registro, no se muestra
  }
  return { ok: true }
}

const SIDECAR_DIR = '__MACOSX'

function safeParts(path: string): string[] | null {
  const parts = path.split('/')
  if (parts[parts.length - 1] === '') parts.pop() // directorio: termina en «/»
  if (parts.length === 0 || parts[0] !== APP_BUNDLE_NAME) return null
  return parts.every((p) => p.length > 0 && p !== '.' && p !== '..') ? parts : null
}

/**
 * Entrada del listado del ZIP (`zipinfo -1`): solo rutas relativas dentro de Lazunox.app/. Única excepción: los metadatos
 * AppleDouble que `ditto --sequesterRsrc` guarda bajo `__MACOSX/Lazunox.app/…/._nombre` (ditto -x los aplica como atributos
 * del archivo y no crea nada fuera de la .app); con las mismas reglas de ruta.
 */
export function isSafeZipEntry(entry: string): boolean {
  if (typeof entry !== 'string' || entry.length === 0 || entry.length > 1024) return false
  if (entry.includes('\0') || entry.includes('\\')) return false
  if (entry.startsWith('/') || /^[A-Za-z]:/.test(entry)) return false
  if (entry === `${SIDECAR_DIR}/`) return true
  if (entry.startsWith(`${SIDECAR_DIR}/`)) {
    const rest = entry.slice(SIDECAR_DIR.length + 1)
    const parts = safeParts(rest)
    if (!parts) return false
    return rest.endsWith('/') || parts[parts.length - 1].startsWith('._')
  }
  return safeParts(entry) !== null
}

export interface InstallLocationInput {
  /** Ruta de la .app en ejecución (p.ej. /Applications/Lazunox.app). */
  appPath: string
  /** `app.isInApplicationsFolder()` (admite /Applications y ~/Applications). */
  inApplicationsFolder: boolean
  parentWritable: boolean
  appWritable: boolean
}

export type LocationCheck =
  { ok: true } | { ok: false; reason: 'not-bundle' | 'translocated' | 'volume' | 'not-applications' | 'not-writable' }

export function validateInstallLocation(i: InstallLocationInput): LocationCheck {
  const p = i.appPath
  if (!p.startsWith('/') || !p.endsWith(`/${APP_BUNDLE_NAME}`)) return { ok: false, reason: 'not-bundle' }
  if (p.includes('/AppTranslocation/')) return { ok: false, reason: 'translocated' }
  if (p.startsWith('/Volumes/')) return { ok: false, reason: 'volume' }
  if (!i.inApplicationsFolder) return { ok: false, reason: 'not-applications' }
  if (!i.parentWritable || !i.appWritable) return { ok: false, reason: 'not-writable' }
  return { ok: true }
}

// ---- Windows --------------------------------------------------------------------------------

const WIN_ROOT = 'Lazunox'
/** CON, PRN, AUX, NUL, COM0-9, LPT0-9 (y COM¹²³/LPT¹²³), con o sin extensión: Windows los trata como dispositivos. */
const WIN_RESERVED_RE = /^(con|prn|aux|nul|conin\$|conout\$|(com|lpt)[0-9\u00b9\u00b2\u00b3])$/i
const WIN_BAD_CHARS_RE = /[\x00-\x1f<>:"|?*\\]/

function winNamePartOk(p: string): boolean {
  if (p.length === 0 || p === '.' || p === '..') return false
  if (WIN_BAD_CHARS_RE.test(p)) return false // incluye «\», «:» (flujos ADS y unidad) y caracteres de control
  if (p.endsWith('.') || p.endsWith(' ')) return false
  return !WIN_RESERVED_RE.test(p.split('.')[0].trimEnd())
}

/**
 * Entrada del índice del ZIP de Windows: solo rutas relativas con «/» dentro de `Lazunox/`. Rechaza `..`, «\», «:» (ADS y
 * unidad), UNC, nombres reservados (CON, NUL, COM1…) y punto o espacio final. La raíz distingue mayúsculas.
 */
export function isSafeZipEntryWin(entry: string): boolean {
  if (typeof entry !== 'string' || entry.length === 0 || entry.length > 1024) return false
  if (!entry.startsWith(`${WIN_ROOT}/`)) return false // una entrada «Lazunox» sin barra sería un archivo, no la raíz
  const parts = entry.split('/')
  if (parts[parts.length - 1] === '') parts.pop() // directorio: termina en «/»
  if (parts.length === 0 || parts[0] !== WIN_ROOT) return false
  return parts.every(winNamePartOk)
}

export interface ZipEntryWin {
  name: string
  isSymlink?: boolean
}

export type ZipEntriesCheckWin = { ok: true } | { ok: false; reason: 'empty' | 'unsafe-name' | 'duplicate' | 'symlink'; entry: string }

/** Comprueba el conjunto: cada nombre, sin symlinks y sin dos entradas que solo difieran en mayúsculas (colisión en NTFS). */
export function checkZipEntriesWin(entries: readonly ZipEntryWin[]): ZipEntriesCheckWin {
  if (entries.length === 0) return { ok: false, reason: 'empty', entry: '' }
  const seen = new Set<string>()
  for (const e of entries) {
    if (!isSafeZipEntryWin(e.name)) return { ok: false, reason: 'unsafe-name', entry: e.name }
    if (e.isSymlink) return { ok: false, reason: 'symlink', entry: e.name }
    const key = (e.name.endsWith('/') ? e.name.slice(0, -1) : e.name).toLowerCase()
    if (seen.has(key)) return { ok: false, reason: 'duplicate', entry: e.name }
    seen.add(key)
  }
  return { ok: true }
}

export interface InstallLocationWinInput {
  /** Carpeta real (realpath) del ejecutable en marcha, p.ej. C:\Users\x\AppData\Local\Programs\Lazunox. */
  installDir: string
  /** %ProgramFiles%, %ProgramFiles(x86)% y %ProgramW6432% (los que existan). */
  programFilesDirs: readonly string[]
  /** %TEMP% */
  tempDir: string
  /** Clave de desinstalación HKCU con DisplayName «Lazunox» (null si no existe); ya leída con reg.exe. */
  readUninstallKey: () => { installLocation: string } | null
  /** ¿Se puede crear y borrar dentro de esa carpeta? */
  isWritable: (dir: string) => boolean
}

export type LocationCheckWin =
  | { ok: true }
  | {
      ok: false
      reason: 'not-absolute' | 'store-package' | 'scoop' | 'program-files' | 'temp' | 'no-uninstall-key' | 'key-mismatch' | 'not-writable'
    }

/** Normaliza una ruta de Windows para comparar: «\», sin barras repetidas ni final, minúsculas. */
function winNorm(p: string): string {
  let n = p.replace(/[\\/]+/g, '\\')
  while (n.length > 3 && n.endsWith('\\')) n = n.slice(0, -1)
  return n.toLowerCase()
}

function winUnder(child: string, parent: string): boolean {
  const c = winNorm(child)
  const q = winNorm(parent)
  return q.length > 0 && (c === q || c.startsWith(q.endsWith('\\') ? q : `${q}\\`))
}

function winParent(p: string): string {
  let n = p.replace(/[\\/]+/g, '\\')
  while (n.length > 3 && n.endsWith('\\')) n = n.slice(0, -1)
  const i = n.lastIndexOf('\\')
  return i <= 2 ? n.slice(0, i + 1) : n.slice(0, i)
}

/** Equivale a `isInApplicationsFolder` del Mac: solo la carpeta por usuario registrada por el instalador NSIS. */
export function validateInstallLocationWin(i: InstallLocationWinInput): LocationCheckWin {
  const dir = i.installDir
  if (typeof dir !== 'string' || !/^[A-Za-z]:[\\/]/.test(dir) || dir.includes('\0')) return { ok: false, reason: 'not-absolute' }
  const n = `${winNorm(dir)}\\`
  if (n.includes('\\windowsapps\\')) return { ok: false, reason: 'store-package' }
  if (n.includes('\\scoop\\apps\\')) return { ok: false, reason: 'scoop' }
  if (n.includes('\\program files\\') || n.includes('\\program files (x86)\\') || i.programFilesDirs.some((d) => winUnder(dir, d)))
    return { ok: false, reason: 'program-files' }
  if (i.tempDir && winUnder(dir, i.tempDir)) return { ok: false, reason: 'temp' }
  const key = i.readUninstallKey()
  if (!key) return { ok: false, reason: 'no-uninstall-key' }
  if (winNorm(key.installLocation) !== winNorm(dir)) return { ok: false, reason: 'key-mismatch' }
  if (!i.isWritable(dir) || !i.isWritable(winParent(dir))) return { ok: false, reason: 'not-writable' }
  return { ok: true }
}

/**
 * Descargas: solo el canal de releases (`RELEASES_ORIGIN`), https://github.com y https://*.githubusercontent.com
 * (GitHub redirige los archivos de una release a ese dominio), sin credenciales ni puerto. `allowLoopbackHttp` solo lo activa la configuración de
 * pruebas (app sin empaquetar).
 */
export function isAllowedDownloadUrl(raw: string, allowLoopbackHttp = false): boolean {
  let u: URL
  try {
    if (/^[a-z]+:\/\/[^/?#]*@/i.test(raw)) return false
    u = new URL(raw)
  } catch {
    return false
  }
  if (u.username || u.password) return false
  if (allowLoopbackHttp && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true
  if (u.protocol !== 'https:' || u.port) return false
  const h = u.hostname.toLowerCase()
  return h === RELEASES_HOST || h === 'github.com' || h.endsWith('.githubusercontent.com')
}

// ---- Estado de la instalación -------------------------------------------------------------

export type InstallPhase = 'idle' | 'downloading' | 'verifying' | 'ready' | 'installing' | 'restarting' | 'error' | 'cancelled'

export interface InstallState {
  phase: InstallPhase
  version: string | null
  received: number
  total: number
  code: InstallErrorCode | null
}

export const IDLE_INSTALL: InstallState = { phase: 'idle', version: null, received: 0, total: 0, code: null }

export type InstallEvent =
  | { type: 'start'; version: string }
  | { type: 'progress'; received: number; total: number }
  | { type: 'verifying' }
  | { type: 'ready' }
  | { type: 'install' }
  | { type: 'restarting' }
  | { type: 'fail'; code: InstallErrorCode }
  | { type: 'cancel' }
  | { type: 'reset' }

/** idle→downloading(p)→verifying→ready→installing→restarting | error(code) | cancelled. Transiciones inválidas se ignoran. */
export function reduceInstall(s: InstallState, e: InstallEvent): InstallState {
  switch (e.type) {
    case 'start':
      return s.phase === 'idle' || s.phase === 'error' || s.phase === 'cancelled'
        ? { phase: 'downloading', version: e.version, received: 0, total: 0, code: null }
        : s
    case 'progress':
      return s.phase === 'downloading' ? { ...s, received: Math.max(0, e.received), total: Math.max(0, e.total) } : s
    case 'verifying':
      return s.phase === 'downloading' ? { ...s, phase: 'verifying' } : s
    case 'ready':
      return s.phase === 'verifying' ? { ...s, phase: 'ready' } : s
    case 'install':
      return s.phase === 'ready' ? { ...s, phase: 'installing' } : s
    case 'restarting':
      return s.phase === 'installing' ? { ...s, phase: 'restarting' } : s
    case 'fail':
      return s.phase === 'downloading' || s.phase === 'verifying' || s.phase === 'installing' || s.phase === 'restarting'
        ? { ...s, phase: 'error', code: e.code }
        : s
    case 'cancel':
      return s.phase === 'downloading' || s.phase === 'verifying' ? { ...s, phase: 'cancelled' } : s
    case 'reset':
      return s.phase === 'downloading' || s.phase === 'verifying' || s.phase === 'installing' || s.phase === 'restarting' ? s : IDLE_INSTALL
  }
}

/** 0..100 (entero) mientras se descarga; null si aún no se conoce el total. */
export function installPercent(s: InstallState): number | null {
  if (s.total <= 0) return null
  return Math.min(100, Math.max(0, Math.floor((s.received / s.total) * 100)))
}

export function installErrorText(code: InstallErrorCode | null): string {
  switch (code) {
    case 'network':
      return t('notices.updateError.network')
    case 'signature':
      return t('notices.updateError.signature')
    case 'downgrade':
      return t('notices.updateError.downgrade')
    case 'hash':
    case 'size':
      return t('notices.updateError.mismatch')
    case 'zip':
    case 'signing':
    case 'manifest':
      return t('notices.updateError.invalid')
    case 'space':
      return t('notices.updateError.space')
    case 'location':
      return t('notices.updateError.location')
    case 'rolled-back':
      return t('notices.updateError.rolledBack')
    case 'install':
      return t('notices.updateError.install')
    default:
      return t('notices.updateError.generic')
  }
}
