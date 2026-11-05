/**
 * «Confiar en la firma de Lazunox» (solo macOS). Lazunox se firma con el certificado autofirmado «Lazunox Local Signing»; mientras macOS no lo
 * considere confiable para firma de código, no reconoce los permisos (Accesibilidad, Grabación de pantalla…) tras reiniciar ni entre
 * actualizaciones. Este módulo:
 *  - decide si la pieza se ofrece: solo en macOS, con el certificado público empaquetado válido (huella fijada, sin llave privada) y SOLO si
 *    la app que corre está firmada con ESE certificado (`codesign -dr -`); en una build de desarrollo, ad-hoc o con otra firma NO aparece;
 *  - lee el estado SIN pedir contraseña (exporta los ajustes de confianza del usuario, solo lectura, y busca la huella);
 *  - confía con `security add-trusted-cert -r trustRoot -p codeSign <cert>` en el dominio de USUARIO (sin `-d`, sin sudo, sin shell; macOS
 *    muestra su propio aviso de contraseña) y lo quita con `security remove-trusted-cert <cert>`.
 * Nunca toca el llavero del sistema ni sube privilegios. Todo se inyecta (`TrustDeps`) para probarlo sin tocar el llavero real.
 */
import { createHash } from 'node:crypto'

/** Huella SHA-1 del certificado público de firma, la misma que fija `scripts/install/install.sh` (PINNED_CERT_SHA1). */
export const PINNED_CERT_SHA1 = '8446c25f2c710d66701c262f048390d8f6edba31'

export const SECURITY_BIN = '/usr/bin/security'
export const CODESIGN_BIN = '/usr/bin/codesign'
export const PLUTIL_BIN = '/usr/bin/plutil'

/** Cuánto se espera al aviso de contraseña de macOS (la persona puede tardar). */
export const TRUST_PROMPT_TIMEOUT_MS = 5 * 60_000

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export interface TrustDeps {
  platform: string
  /** `process.execPath` de la app que corre. */
  execPath: string
  /** Ruta ABSOLUTA del certificado público empaquetado, o `null` si no está. */
  certPath: string | null
  /** `execFile` sin shell: archivo + argumentos. No lanza: devuelve el código de salida. */
  run: (file: string, args: readonly string[], timeoutMs?: number) => Promise<RunResult>
  readFile: (path: string) => Promise<string>
  /** Archivo temporal único donde exportar los ajustes de confianza (y su borrado). */
  tempFile: () => Promise<{ path: string; cleanup: () => Promise<void> }>
}

export type TrustState = 'hidden' | 'trusted' | 'untrusted'

/** DER del certificado, o `null` si el archivo no es un único certificado público (p. ej. trae una llave privada). */
export function certDer(pem: string): Buffer | null {
  if (/PRIVATE KEY/.test(pem)) return null
  const blocks = [...pem.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)]
  if (blocks.length !== 1) return null
  const b64 = blocks[0][1].replace(/\s+/g, '')
  return /^[A-Za-z0-9+/=]+$/.test(b64) && b64.length > 0 ? Buffer.from(b64, 'base64') : null
}

export function certSha1(pem: string): string | null {
  const der = certDer(pem)
  return der ? createHash('sha1').update(der).digest('hex') : null
}

/** `/…/Lazunox.app/Contents/MacOS/Lazunox` → `/…/Lazunox.app`; `null` si no corre dentro de un `.app`. */
export function appBundleOf(execPath: string): string | null {
  const m = /^(.*?\.app)(?:\/|$)/.exec(execPath)
  return m ? m[1] : null
}

/** ¿La salida de `codesign -dr -` dice que la hoja es el certificado fijado? */
export function leafIsPinned(out: string): boolean {
  const m = /certificate leaf\s*=\s*H"([0-9a-fA-F]{40})"/.exec(out)
  return m !== null && m[1].toLowerCase() === PINNED_CERT_SHA1
}

/** ¿Hay un certificado empaquetado, válido y con la huella fijada? (`null` = no) */
export async function packagedCertOk(d: Pick<TrustDeps, 'certPath' | 'readFile'>): Promise<boolean> {
  if (!d.certPath) return false
  try {
    return certSha1(await d.readFile(d.certPath)) === PINNED_CERT_SHA1
  } catch {
    return false
  }
}

/** ¿La app que corre está firmada con el certificado fijado? */
export async function runningAppSignedWithPinned(d: Pick<TrustDeps, 'execPath' | 'run'>): Promise<boolean> {
  const bundle = appBundleOf(d.execPath)
  if (!bundle) return false
  const r = await d.run(CODESIGN_BIN, ['-dr', '-', bundle]).catch(() => null)
  return r !== null && r.code === 0 && leafIsPinned(`${r.stdout}\n${r.stderr}`)
}

interface TrustSettingsJson {
  trustList?: Record<string, { trustSettings?: Array<{ kSecTrustSettingsPolicyName?: string; kSecTrustSettingsResult?: number }> }>
}

/** ¿Ya confía el usuario en el certificado fijado para firma de código? Solo lectura, sin contraseña. */
export function isTrustedIn(json: unknown): boolean {
  const list = (json as TrustSettingsJson | null)?.trustList
  const entry = list?.[PINNED_CERT_SHA1.toUpperCase()] ?? list?.[PINNED_CERT_SHA1]
  const settings = entry?.trustSettings
  if (!Array.isArray(settings) || settings.length === 0) return false
  // Resultado ausente = «confiar» por omisión; 1 = confiar (raíz); 2 = confiar (certificado); el resto (denegar, desconfiar) no cuenta.
  return settings.some(
    (s) =>
      s.kSecTrustSettingsPolicyName === 'CodeSigning' &&
      (s.kSecTrustSettingsResult === undefined || s.kSecTrustSettingsResult === 1 || s.kSecTrustSettingsResult === 3)
  )
}

async function readUserTrustSettings(d: Pick<TrustDeps, 'run' | 'tempFile'>): Promise<unknown | null> {
  const tmp = await d.tempFile()
  try {
    const exp = await d.run(SECURITY_BIN, ['trust-settings-export', tmp.path])
    if (exp.code !== 0) return null
    const conv = await d.run(PLUTIL_BIN, ['-convert', 'json', '-o', '-', '--', tmp.path])
    if (conv.code !== 0) return null
    return JSON.parse(conv.stdout)
  } catch {
    return null
  } finally {
    await tmp.cleanup().catch(() => undefined)
  }
}

/** `hidden` si la pieza no corresponde (no macOS, sin certificado válido o la app no está firmada con él). */
export async function trustState(d: TrustDeps): Promise<TrustState> {
  if (d.platform !== 'darwin') return 'hidden'
  if (!(await packagedCertOk(d))) return 'hidden'
  if (!(await runningAppSignedWithPinned(d))) return 'hidden'
  return isTrustedIn(await readUserTrustSettings(d)) ? 'trusted' : 'untrusted'
}

export interface TrustOutcome {
  ok: boolean
  /** `cancelled`: la persona canceló el aviso de macOS (no es un error). `failed`: macOS lo rechazó. `unavailable`: la pieza no corresponde. */
  error?: 'cancelled' | 'failed' | 'unavailable'
  message?: string
}

const CANCELLED = /cancel|-60006|-60007|user interaction|errAuthorizationCanceled/i

/** Argumentos EXACTOS (sin shell): dominio de usuario (sin `-d`), raíz de confianza, solo para firma de código. */
export function addTrustArgs(certPath: string): string[] {
  return ['add-trusted-cert', '-r', 'trustRoot', '-p', 'codeSign', certPath]
}
export function removeTrustArgs(certPath: string): string[] {
  return ['remove-trusted-cert', certPath]
}

async function changeTrust(d: TrustDeps, args: (cert: string) => string[], expect: TrustState): Promise<TrustOutcome> {
  const state = await trustState(d)
  if (state === 'hidden' || !d.certPath) return { ok: false, error: 'unavailable' }
  const r = await d
    .run(SECURITY_BIN, args(d.certPath), TRUST_PROMPT_TIMEOUT_MS)
    .catch((): RunResult => ({ code: 1, stdout: '', stderr: 'no se pudo ejecutar security' }))
  if (r.code !== 0) {
    const text = `${r.stderr}\n${r.stdout}`.trim()
    return CANCELLED.test(text) ? { ok: false, error: 'cancelled' } : { ok: false, error: 'failed', message: text.slice(0, 500) }
  }
  // Se vuelve a comprobar: «ok» solo si macOS de verdad quedó en el estado pedido.
  return (await trustState(d)) === expect ? { ok: true } : { ok: false, error: 'failed', message: 'macOS no aplicó el cambio' }
}

/** Confía en la firma (macOS pide su contraseña una vez). Si ya confía, no hace nada. */
export async function trustCertificate(d: TrustDeps): Promise<TrustOutcome> {
  if ((await trustState(d)) === 'trusted') return { ok: true }
  return changeTrust(d, addTrustArgs, 'trusted')
}

/** Quita la confianza (botón de Ajustes). */
export async function untrustCertificate(d: TrustDeps): Promise<TrustOutcome> {
  if ((await trustState(d)) === 'untrusted') return { ok: true }
  return changeTrust(d, removeTrustArgs, 'untrusted')
}
