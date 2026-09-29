/**
 * La app se llamó «OpenDesk» y luego «Lapis» durante el desarrollo: conserva ajustes, rutinas y sesiones de cualquiera
 * de esos nombres anteriores. Se revisan en orden (el más reciente primero) y, para el primero que tenga datos reales,
 * se copian entrada por entrada las que aún no existen en la carpeta nueva (nunca se sobrescribe nada que ya esté ahí).
 * Chromium puede crear la carpeta nueva antes de que corra este código, así que se mueven las entradas sueltas en vez
 * de renombrar la carpeta completa.
 *
 * Se llama al arrancar, antes de `ready` (comportamiento heredado de `index.ts`); recibe las rutas para poder probarse.
 */
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { LEGACY_APP_NAMES } from './legacy-names'

export function migrateLegacyUserData(
  userData: string,
  appData: string,
  log: (msg: string, err?: unknown) => void = (msg, err) => console.error(msg, err)
): void {
  for (const legacyName of LEGACY_APP_NAMES) {
    if (existsSync(join(userData, 'settings.json'))) break
    const legacyUserData = join(appData, legacyName)
    if (!existsSync(join(legacyUserData, 'settings.json'))) continue
    mkdirSync(userData, { recursive: true })
    for (const entry of readdirSync(legacyUserData)) {
      const target = join(userData, entry)
      if (existsSync(target)) continue
      try {
        renameSync(join(legacyUserData, entry), target)
      } catch (err) {
        log(`[main] no se pudo migrar ${entry} de ${legacyName}:`, err)
      }
    }
  }
}
