/**
 * Listas LEGIBLES de apps bloqueadas para Ajustes › Control del Mac/PC (solo presentación; la lógica de bloqueo vive en
 * `src/main/computer/policy/*-apps.ts`, y una prueba comprueba que estas listas coinciden con ella).
 *  - Fijas: bloqueadas por seguridad, sin botón para desbloquear.
 *  - Sugeridas: apps sensibles (carteras cripto y brokers) NO bloqueadas por defecto; un clic las bloquea.
 */

import type { MsgKey } from './i18n'

export interface LabeledApp {
  /** Clave con la que se bloquea o se reconoce (bundle id en macOS, nombre del ejecutable en Windows). */
  id: string
  /** Nombre en español (respaldo y fuente de las pruebas). Si hay `nameKey`, la interfaz usa la traducción. */
  name: string
  /** Clave i18n del nombre (solo los nombres que no son marcas: «Contraseñas», «Pantalla de bloqueo»…). */
  nameKey?: MsgKey
}

/** Nombre de una app fija en el idioma de la interfaz (marcas como «Bitwarden» no se traducen). */
export function labeledAppName(app: LabeledApp, t: (key: MsgKey) => string): string {
  return app.nameKey ? t(app.nameKey) : app.name
}

/** macOS: bloqueos fijos. `id` termina en `.` cuando es un prefijo de proveedor (ver `MAC_BLOCKED_BUNDLE_PREFIXES`). */
export const MAC_FIXED_BLOCKED: readonly LabeledApp[] = [
  { id: 'com.apple.Passwords', name: 'Contraseñas', nameKey: 'tasksComputer.fixedApp.passwords' },
  { id: 'com.lastpass.LastPass', name: 'LastPass' },
  { id: 'com.1password.', name: '1Password' },
  { id: 'com.agilebits.', name: '1Password (versión anterior)', nameKey: 'tasksComputer.fixedApp.agilebits' },
  { id: 'com.bitwarden.', name: 'Bitwarden' },
  { id: 'org.keepassxc.', name: 'KeePassXC' }
]

/** Windows: bloqueos fijos (espejo de `WIN_BLOCKED_EXES`), con el nombre que entiende una persona. */
export const WIN_FIXED_BLOCKED: readonly LabeledApp[] = [
  { id: 'consent.exe', name: 'Avisos de permisos de administrador', nameKey: 'tasksComputer.fixedApp.uac' },
  { id: 'credentialuibroker.exe', name: 'Credenciales de Windows', nameKey: 'tasksComputer.fixedApp.credentials' },
  { id: 'logonui.exe', name: 'Pantalla de inicio de sesión', nameKey: 'tasksComputer.fixedApp.logon' },
  { id: 'lockapp.exe', name: 'Pantalla de bloqueo', nameKey: 'tasksComputer.fixedApp.lock' },
  { id: 'winlogon.exe', name: 'Inicio de sesión de Windows', nameKey: 'tasksComputer.fixedApp.winlogon' },
  { id: 'securityhealthui.exe', name: 'Seguridad de Windows', nameKey: 'tasksComputer.fixedApp.secHealth' },
  { id: 'sechealthui.exe', name: 'Seguridad de Windows (antiguo)', nameKey: 'tasksComputer.fixedApp.secHealthOld' },
  { id: 'mmc.exe', name: 'Consola de administración (mmc)', nameKey: 'tasksComputer.fixedApp.mmc' },
  { id: 'regedit.exe', name: 'Editor del Registro (regedit)', nameKey: 'tasksComputer.fixedApp.regedit' },
  { id: 'taskmgr.exe', name: 'Administrador de tareas', nameKey: 'tasksComputer.fixedApp.taskmgr' },
  { id: '1password.exe', name: '1Password' },
  { id: 'bitwarden.exe', name: 'Bitwarden' },
  { id: 'keepass.exe', name: 'KeePass' },
  { id: 'keepassxc.exe', name: 'KeePassXC' },
  { id: 'dashlane.exe', name: 'Dashlane' },
  { id: 'lastpass.exe', name: 'LastPass' },
  { id: 'enpass.exe', name: 'Enpass' },
  { id: 'nordpass.exe', name: 'NordPass' }
]

/**
 * Sugeridas en macOS: solo las que tienen bundle id conocido (`PENDING_TO_CONFIRM` en policy/mac-apps.ts). Las demás carteras y
 * brokers se añadirán aquí cuando se confirme su id en un Mac real (bloquear con un id equivocado no bloquearía nada).
 */
export const MAC_SUGGESTED_BLOCK: readonly LabeledApp[] = [
  { id: 'com.ledger.live', name: 'Ledger Live' },
  { id: 'com.exodus.exodus', name: 'Exodus' }
]

/** Sugeridas en Windows: ninguna confirmada todavía (las claves de Windows incluyen el editor; ver policy/app-key.ts). */
export const WIN_SUGGESTED_BLOCK: readonly LabeledApp[] = []

/**
 * Nombre legible para una clave de app denegada sin nombre guardado (bloqueos antiguos): ejecutable de Windows sin ruta ni
 * editor, o el último tramo del bundle id. Nunca devuelve una cadena vacía.
 */
export function friendlyAppName(key: string): string {
  const raw = key.trim()
  if (!raw) return key
  if (/^exe:/i.test(raw)) {
    const path = raw.slice(4).split('|')[0] ?? ''
    const base = path.split(/[\\/]/).pop() ?? path
    return base.replace(/\.exe$/i, '') || raw
  }
  if (/^aumid:/i.test(raw)) return raw.slice(6).split('!')[0]?.split('_')[0] || raw
  const last = raw.split('.').filter(Boolean).pop() ?? raw
  return last.charAt(0).toUpperCase() + last.slice(1)
}
