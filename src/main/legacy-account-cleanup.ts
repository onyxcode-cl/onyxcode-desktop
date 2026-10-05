import { lstatSync, unlinkSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/**
 * Sesión que dejó la antigua cuenta (retirada en 0.4.x): `account.bin` (cifrado, con un token portador),
 * `account.test.json` (almacén en claro de los E2E) y sus `.tmp` de una escritura interrumpida.
 * Se puede quitar esta limpieza en una versión >= 0.6.
 */
export const LEGACY_ACCOUNT_FILES = ['account.bin', 'account.bin.tmp', 'account.test.json', 'account.test.json.tmp'] as const

/**
 * Borra esos archivos, solo directamente dentro de `userDataDir`. Si uno es un enlace simbólico se borra el enlace,
 * nunca su destino; las carpetas con el mismo nombre no se tocan. No recibe `safeStorage` ni toca el Llavero
 * (`remote.bin` sigue descifrándose). Nunca lanza: un fallo se registra y se sigue. Idempotente.
 * Devuelve las rutas que existían y se borraron.
 */
export function cleanLegacyAccountSession(userDataDir: string): string[] {
  const removed: string[] = []
  let base: string
  try {
    base = resolve(userDataDir)
  } catch {
    return removed
  }
  for (const name of LEGACY_ACCOUNT_FILES) {
    const target = resolve(join(base, name))
    if (!target.startsWith(base + sep)) continue
    try {
      const st = lstatSync(target)
      if (!st.isFile() && !st.isSymbolicLink()) continue
      unlinkSync(target)
      removed.push(target)
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') continue
      console.warn('[main] no se pudo borrar', target, err)
    }
  }
  return removed
}
