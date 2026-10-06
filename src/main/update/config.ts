import { isValidRepo } from '@shared/update-check'
import { decodePublicKey, type UpdateKey } from './signature'

export const GITHUB_API_BASE = 'https://api.github.com'

/**
 * Team ID de Apple (10 caracteres, p. ej. «ABCDE12345») del certificado Developer ID con el que se firma Lazunox.
 * Vacío = sin cambio (solo se comprueba el identificador, como hasta ahora). Con valor, `UpdateInstaller.verifyApp` exige
 * además que la app descargada esté firmada con ese equipo (`anchor apple generic and certificate leaf[subject.OU]`):
 * defensa adicional a la firma Ed25519. Se rellena al tener el certificado (docs/RELEASE.md). Vive aquí y no en brand.ts
 * por ahora; al consolidar la identidad puede moverse allí.
 */
export const UPDATE_TEAM_ID = '' as string

/**
 * Huella SHA-1 (40 hex en mayúsculas) del certificado Authenticode con el que se firmaría Lazunox.exe en Windows. Vacío = no
 * se comprueba (hoy no hay certificado; la autenticidad la da solo la firma Ed25519 del manifiesto). Con valor,
 * `WinUpdateInstaller.verifyApp` exige Authenticode válido con esa huella; un valor mal formado falla cerrado.
 */
export const UPDATE_WIN_CERT_THUMBPRINT = '' as string

export interface UpdateConfig {
  /** false = sin red y aviso apagado (no hay repositorio o la variable de test no aplica). */
  configured: boolean
  repo: string
  apiBase: string
  startDelayMs: number
}

export interface ResolveInput {
  isPackaged: boolean
  env: Record<string, string | undefined>
  /** Valor de `RELEASES_REPO` (brand.ts). */
  repo: string
}

const DEFAULT_TEST_DELAY_MS = 500
const PACKAGED_DELAY_MS = 8000

/** Solo `http://127.0.0.1:<puerto>` (servidor local de tests) o cualquier `https:` sin credenciales. */
function testApiBase(raw: string | undefined): string | null {
  if (!raw) return null
  if (/^http:\/\/127\.0\.0\.1:\d{1,5}\/?$/.test(raw)) return raw.replace(/\/+$/, '')
  try {
    const u = new URL(raw)
    if (u.protocol === 'https:' && !u.username && !u.password) return raw.replace(/\/+$/, '')
  } catch {
    /* no es una URL */
  }
  return null
}

/**
 * App empaquetada: SIEMPRE la API de GitHub y `RELEASES_REPO`; las variables de entorno se ignoran
 * (patrón de `LAZUNOX_TEST_BUNDLED_DIR`). Sin empaquetar: solo con las variables de test
 * `LAZUNOX_TEST_RELEASES_API` (+ `_REPO`, `LAZUNOX_TEST_UPDATE_DELAY_MS`); si no, apagado.
 */
export function resolveUpdateConfig(i: ResolveInput): UpdateConfig {
  if (i.isPackaged) {
    return { configured: isValidRepo(i.repo), repo: i.repo, apiBase: GITHUB_API_BASE, startDelayMs: PACKAGED_DELAY_MS }
  }
  const api = testApiBase(i.env.LAZUNOX_TEST_RELEASES_API)
  if (!api) return { configured: false, repo: i.repo, apiBase: GITHUB_API_BASE, startDelayMs: PACKAGED_DELAY_MS }
  const repo = i.env.LAZUNOX_TEST_RELEASES_REPO ?? i.repo
  const d = Number(i.env.LAZUNOX_TEST_UPDATE_DELAY_MS)
  const startDelayMs = Number.isFinite(d) && d >= 0 && d <= 60_000 ? d : DEFAULT_TEST_DELAY_MS
  return { configured: isValidRepo(repo), repo, apiBase: api, startDelayMs }
}

export interface InstallConfig {
  /** Instalador activo: repositorio válido + clave pública + macOS o Windows x64 (fuera de la Store). Si no, la interfaz queda como el aviso de siempre. */
  enabled: boolean
  /** Origen de `…/{owner}/{repo}/releases/download/{tag}/…` (https://github.com; en tests el servidor local). */
  downloadBase: string
  allowLoopbackHttp: boolean
  keys: UpdateKey[]
  /** Solo pruebas (app sin empaquetar): carpeta que hace de «carpeta de instalación». */
  testInstallDir: string | null
}

export interface InstallResolveInput extends ResolveInput {
  update: UpdateConfig
  /** `UPDATE_PUBLIC_KEY` y `UPDATE_KEY_ID` (brand.ts). */
  updateKey: string
  updateKeyId: string
  /**
   * Claves adicionales aceptadas (rotación, docs/RELEASE.md §Claves): p. ej. la vieja mientras la nueva ya es la principal.
   * Las inválidas se descartan. Solo cuentan en la app empaquetada.
   */
  updateKeys?: readonly UpdateKey[]
  platform: string
  /** `process.arch`. En Windows solo `x64` tiene actualizador (ZIP win32-x64); sin dato, Windows queda apagado. */
  arch?: string
  /** `process.windowsStore` (build MSIX de la Store: la actualiza la Store, nunca el actualizador propio). */
  windowsStore?: boolean
}

/** Plataformas con actualizador propio (la de cada una está en UPDATE_PLATFORMS). */
export function updaterSupported(i: { platform: string; arch?: string; windowsStore?: boolean }): boolean {
  if (i.platform === 'darwin') return true
  return i.platform === 'win32' && i.arch === 'x64' && i.windowsStore !== true
}

/**
 * App empaquetada: clave de brand.ts y https://github.com, las variables de entorno se ignoran.
 * Sin empaquetar: `LAZUNOX_TEST_UPDATE_PUBKEY` y `LAZUNOX_TEST_UPDATE_INSTALL_DIR` (con el servidor de test).
 */
export function resolveInstallConfig(i: InstallResolveInput): InstallConfig {
  const key = i.isPackaged ? i.updateKey : (i.env.LAZUNOX_TEST_UPDATE_PUBKEY ?? '')
  const main: UpdateKey[] = key !== '' && decodePublicKey(key) ? [{ id: i.updateKeyId, key }] : []
  const extra = i.isPackaged ? (i.updateKeys ?? []).filter((k) => decodePublicKey(k.key)) : []
  const keys = main.length > 0 ? [...main, ...extra] : [...extra]
  const enabled = i.update.configured && keys.length > 0 && updaterSupported(i)
  const testEnvDir = !i.isPackaged ? i.env.LAZUNOX_TEST_UPDATE_INSTALL_DIR : undefined
  const testDirOk = i.platform === 'win32' ? /^[A-Za-z]:\\[^\\]/.test(testEnvDir ?? '') : (testEnvDir ?? '').startsWith('/')
  const testDir = testEnvDir && testDirOk ? testEnvDir : null
  return {
    enabled,
    downloadBase: i.isPackaged ? 'https://github.com' : i.update.apiBase,
    allowLoopbackHttp: !i.isPackaged && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(i.update.apiBase),
    keys,
    testInstallDir: testDir
  }
}
