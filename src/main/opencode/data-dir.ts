/**
 * Almacén de datos propio de OnyxCode para el motor (OpenCode): claves de proveedores (auth.json),
 * sesiones y base de datos. Vive en `userData/opencode-data` y se entrega al motor con
 * `XDG_DATA_HOME`, de modo que la app tiene su propia conexión, aislada del CLI del usuario.
 *
 * Funciones puras que reciben `userData` (no importan electron) para poder probarlas.
 */
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Valor de `XDG_DATA_HOME` para el motor de la app. OpenCode escribe en `<esto>/opencode`. */
export function opencodeDataHome(userData: string): string {
  return join(userData, 'opencode-data')
}

/** `auth.json` propio de la app (`Path.data/auth.json` del motor). */
export function appAuthFile(userData: string): string {
  return join(opencodeDataHome(userData), 'opencode', 'auth.json')
}

/** Crea (0700) el directorio de datos del motor. `created` indica que no existía. */
export function prepareOpencodeData(userData: string): { created: boolean } {
  const dir = join(opencodeDataHome(userData), 'opencode')
  const created = !existsSync(dir)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return { created }
}

/**
 * Instalación existente que estrena el almacén propio: había asistente completado y espacio de
 * chat, pero el almacén acaba de crearse (vacío) → hay que reabrir el asistente una vez.
 */
export function shouldReopenOnboarding(o: { created: boolean; chatWorkspaceExists: boolean; onboarded: boolean }): boolean {
  return o.created && o.chatWorkspaceExists && o.onboarded
}
