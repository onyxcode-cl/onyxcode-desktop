/**
 * Comprobación de acceso a una carpeta antes de abrirla como proyecto (F8-B210).
 *
 * En macOS las carpetas protegidas (Documentos, Escritorio, Descargas, iCloud Drive, volúmenes externos o de red) piden permiso a
 * la app la primera vez (TCC). Si la persona pulsa «No permitir», macOS recuerda la negativa y desde entonces leer la carpeta falla
 * con EPERM/EACCES sin volver a preguntar; con la pregunta aún abierta, la lectura se queda bloqueada hasta que se responde. Esta
 * función lee UNA entrada de la carpeta (lo que TCC protege) con un tiempo límite y distingue el resultado. No consulta ni cambia
 * ningún ajuste de privacidad: solo lee.
 */
import { execFile } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { opendir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { APP_ID } from '@shared/brand'
import type { FolderAccess, FolderResetResult } from '@shared/ipc-code'

export interface FolderAccessDeps {
  /** Abre la carpeta y lee como mucho una entrada; rechaza con el error del sistema. Debe cerrar el descriptor. */
  probe: (path: string) => Promise<void>
  /** Tiempo máximo de espera (ms). */
  timeoutMs: number
  platform: NodeJS.Platform
}

/** Margen para que la persona responda al aviso de macOS (la lectura queda bloqueada mientras tanto). */
export const FOLDER_ACCESS_TIMEOUT_MS = 20_000

export async function defaultProbe(path: string): Promise<void> {
  const dir = await opendir(path)
  try {
    await dir.read()
  } finally {
    await dir.close().catch(() => undefined)
  }
}

export function defaultFolderAccessDeps(): FolderAccessDeps {
  return { probe: defaultProbe, timeoutMs: FOLDER_ACCESS_TIMEOUT_MS, platform: process.platform }
}

/**
 * `ok`: se puede leer. `denied`: EPERM/EACCES (macOS u otro permiso). `missing`: no existe o no es una carpeta.
 * `timeout`: no respondió a tiempo (aviso de macOS sin contestar, volumen de red colgado). Cualquier otro error se trata como `ok`
 * (lo informará el motor con su propio mensaje; esta comprobación no bloquea por causas que no entiende). Fuera de macOS solo se
 * distingue `missing`: la tarjeta explica los permisos de macOS y no aplica a otros sistemas.
 */
export async function checkFolderAccess(path: string, deps: FolderAccessDeps = defaultFolderAccessDeps()): Promise<FolderAccess> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), deps.timeoutMs)
  })
  // Si vence el tiempo, la lectura sigue pendiente: se deja resolver sin que su rechazo tardío quede sin atender.
  const attempt = deps.probe(path).then(
    () => 'ok' as const,
    (err: unknown) => err
  )
  try {
    const first = await Promise.race([attempt, timedOut])
    if (first === 'timeout') return deps.platform === 'darwin' ? 'timeout' : 'ok'
    if (first === 'ok') return 'ok'
    const code = (first as NodeJS.ErrnoException | null)?.code
    if (code === 'ENOENT' || code === 'ENOTDIR') return 'missing'
    if (deps.platform !== 'darwin') return 'ok'
    if (code === 'EPERM' || code === 'EACCES') return 'denied'
    return 'ok'
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/** Panel «Archivos y carpetas» de Privacidad y seguridad (ahí también se llega a «Acceso total al disco»). */
export const PANE_FILES_AND_FOLDERS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders'

/**
 * Servicios de privacidad (TCC) de macOS que protegen una carpeta, según su ruta. LISTA FIJA: el renderer nunca elige el servicio,
 * solo manda la ruta y aquí se deriva. Documentos, Escritorio y Descargas son de la carpeta personal; en `/Volumes` no se distingue
 * por ruta entre un disco externo y uno de red, así que se restablecen los dos servicios (solo afecta a Lazunox). iCloud Drive usa
 * `Ubiquity` (SIN verificar en un Mac real: si el nombre no valiera, `tccutil` falla y la tarjeta lo dice sin tocar nada).
 */
export const TCC_FOLDER_SERVICES = [
  'SystemPolicyDocumentsFolder',
  'SystemPolicyDesktopFolder',
  'SystemPolicyDownloadsFolder',
  'SystemPolicyNetworkVolumes',
  'SystemPolicyRemovableVolumes',
  'Ubiquity'
] as const
export type TccFolderService = (typeof TCC_FOLDER_SERVICES)[number]

function realOrSame(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Servicios a restablecer para `path` (solo tiene sentido en macOS: rutas con `/`, por eso no usa `path.sep`), o `[]` si la carpeta no está en una zona protegida por TCC. */
export function tccServicesFor(path: string, home: string = homedir()): TccFolderService[] {
  const inside = (p: string, base: string): boolean => {
    const a = p.toLowerCase()
    const b = base.toLowerCase()
    return a === b || a.startsWith(b + '/')
  }
  const real = realOrSame(path)
  const h = realOrSame(home)
  for (const cand of new Set([real, path])) {
    if (inside(cand, `${h}/Library/Mobile Documents/com~apple~CloudDocs`)) return ['Ubiquity']
    if (inside(cand, `${h}/Documents`)) return ['SystemPolicyDocumentsFolder']
    if (inside(cand, `${h}/Desktop`)) return ['SystemPolicyDesktopFolder']
    if (inside(cand, `${h}/Downloads`)) return ['SystemPolicyDownloadsFolder']
    if (cand.startsWith('/Volumes/') && cand.length > '/Volumes/'.length)
      return ['SystemPolicyRemovableVolumes', 'SystemPolicyNetworkVolumes']
  }
  return []
}

export interface ResetDeps {
  platform: NodeJS.Platform
  home: string
  appId: string
  /** `execFile` sin shell; rechaza si el proceso sale con error o vence el plazo. */
  run: (file: string, args: string[], timeoutMs: number) => Promise<void>
  timeoutMs: number
}

export function defaultResetDeps(): ResetDeps {
  return {
    platform: process.platform,
    home: homedir(),
    appId: APP_ID,
    timeoutMs: 5000,
    run: (file, args, timeoutMs) =>
      new Promise((resolve, reject) => {
        execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err) => (err ? reject(err) : resolve()))
      })
  }
}

/**
 * Borra SOLO la decisión de privacidad de Lazunox para la zona de esa carpeta (`/usr/bin/tccutil reset <servicio> <APP_ID>`), para que
 * macOS vuelva a preguntar «Permitir / No permitir». Solo macOS, sin shell ni sudo, ruta absoluta del binario, servicio de la lista
 * fija y el identificador de la app tomado de la constante (nunca del renderer). Se llama únicamente cuando la persona pulsa el botón.
 */
export async function resetFolderPermission(path: string, deps: ResetDeps = defaultResetDeps()): Promise<FolderResetResult> {
  if (deps.platform !== 'darwin') return 'unsupported'
  const services = tccServicesFor(path, deps.home)
  if (services.length === 0) return 'unsupported'
  try {
    for (const svc of services) await deps.run('/usr/bin/tccutil', ['reset', svc, deps.appId], deps.timeoutMs)
    return 'reset'
  } catch {
    return 'failed'
  }
}

/** Panel de Privacidad y seguridad › Acceso total al disco. */
export const PANE_ALL_FILES = 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles'
