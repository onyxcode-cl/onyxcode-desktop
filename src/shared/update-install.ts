/**
 * Lógica pura (sin Electron ni Node) del actualizador propio: manifiesto firmado, validación
 * anti-downgrade, entradas seguras del ZIP, lugar de instalación y reductor de estados.
 * La AUTENTICIDAD la da solo la firma Ed25519 del manifiesto (src/main/update/signature.ts);
 * `codesign` solo comprueba integridad y coherencia del paquete.
 */
import { isNewerRelease, parseSemver } from './update-check'

/** Nombre de la .app dentro del ZIP. */
export const APP_BUNDLE_NAME = 'OnyxCode.app'
export const MANIFEST_NAME = 'update.json'
export const MANIFEST_SIG_NAME = 'update.json.sig'
export const MANIFEST_MAX_BYTES = 16 * 1024
export const SIGNATURE_MAX_BYTES = 1024
export const ZIP_MAX_BYTES = 600 * 1024 * 1024
export const PLATFORM = 'darwin-arm64'
export const MAX_REDIRECTS = 3

const ZIP_NAME_RE = /^OnyxCode-\d+\.\d+\.\d+-arm64\.zip$/
const SHA256_RE = /^[0-9a-f]{64}$/

export interface UpdateManifest {
  schema: 1
  appId: string
  version: string
  tag: string
  platform: typeof PLATFORM
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

/** Interpreta el JSON YA verificado por firma. Devuelve null si la forma no es exactamente la esperada. */
export function parseManifest(json: unknown): UpdateManifest | null {
  if (!isObj(json) || json.schema !== 1) return null
  const { appId, version, tag, platform, keyId, zip, publishedAt } = json
  if (typeof appId !== 'string' || appId.length === 0 || appId.length > 128) return null
  if (typeof version !== 'string' || version.length > 64 || !parseSemver(version)) return null
  if (typeof tag !== 'string' || tag.length === 0 || tag.length > 128) return null
  if (platform !== PLATFORM) return null
  if (typeof keyId !== 'string' || keyId.length === 0 || keyId.length > 64) return null
  if (typeof publishedAt !== 'string' || publishedAt.length > 64 || !Number.isFinite(Date.parse(publishedAt))) return null
  if (!isObj(zip)) return null
  const { name, size, sha256 } = zip
  if (typeof name !== 'string' || typeof sha256 !== 'string') return null
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > ZIP_MAX_BYTES) return null
  if (!SHA256_RE.test(sha256)) return null
  return { schema: 1, appId, version, tag, platform, keyId, zip: { name, size, sha256 }, publishedAt }
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
  if (m.tag !== ctx.tag) return { ok: false, code: 'manifest', reason: 'el tag no coincide con la release' }
  if (m.version !== ctx.tag.replace(/^v/, '')) return { ok: false, code: 'manifest', reason: 'la versión no coincide con el tag' }
  if (!isNewerRelease({ tag: m.version, prerelease: false, draft: false }, ctx.current)) {
    return { ok: false, code: 'downgrade', reason: 'la versión no es mayor que la instalada' }
  }
  if (!ZIP_NAME_RE.test(m.zip.name) || m.zip.name !== `OnyxCode-${m.version}-arm64.zip`) {
    return { ok: false, code: 'manifest', reason: 'nombre de ZIP no válido' }
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
 * Entrada del listado del ZIP (`zipinfo -1`): solo rutas relativas dentro de OnyxCode.app/. Única excepción: los metadatos
 * AppleDouble que `ditto --sequesterRsrc` guarda bajo `__MACOSX/OnyxCode.app/…/._nombre` (ditto -x los aplica como atributos
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
  /** Ruta de la .app en ejecución (p.ej. /Applications/OnyxCode.app). */
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

/**
 * Descargas: solo https://github.com y https://*.githubusercontent.com (las releases redirigen a
 * release-assets/objects.githubusercontent.com), sin credenciales ni puerto. `allowLoopbackHttp`
 * solo lo activa la configuración de pruebas (app sin empaquetar).
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
  return h === 'github.com' || h.endsWith('.githubusercontent.com')
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
      return 'No se pudo descargar la actualización. Revisa tu conexión.'
    case 'signature':
      return 'La actualización no pasó la comprobación de autenticidad y se descartó.'
    case 'downgrade':
      return 'La actualización ofrecida no es más nueva que la instalada y se descartó.'
    case 'hash':
    case 'size':
      return 'El archivo descargado no coincide con lo publicado y se descartó.'
    case 'zip':
    case 'signing':
    case 'manifest':
      return 'El paquete descargado no es válido y se descartó.'
    case 'space':
      return 'No hay espacio libre suficiente para actualizar.'
    case 'location':
      return 'Esta copia de la app no se puede actualizar sola desde aquí.'
    case 'rolled-back':
      return 'La versión nueva no arrancó bien y se volvió a la anterior.'
    case 'install':
      return 'No se pudo instalar la actualización. La versión actual sigue intacta.'
    default:
      return 'No se pudo actualizar.'
  }
}
