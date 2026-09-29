import { existsSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/** Entradas de userData que dejó el antiguo «Chrome aparte» (perfil, cookies, descargas y ajustes). */
export const LEGACY_BROWSER_ENTRIES = ['cowork-browser', 'cowork-browser.json'] as const

/**
 * Borra los datos huérfanos de «Chrome aparte» (eliminado en el refactor, fase 3). Solo toca
 * entradas cuya ruta resuelta queda estrictamente DENTRO de `userDataDir`; nunca borra fuera.
 * Nunca lanza: un fallo (permisos, archivo en uso) se registra y se sigue. Devuelve las rutas
 * que realmente existían y se borraron. Idempotente: tras borrar, no hay nada más que hacer.
 */
export function cleanLegacyBrowserData(userDataDir: string): string[] {
  const base = resolve(userDataDir)
  const removed: string[] = []
  for (const name of LEGACY_BROWSER_ENTRIES) {
    const target = resolve(join(base, name))
    if (!target.startsWith(base + sep)) continue
    try {
      if (!existsSync(target)) continue
      rmSync(target, { recursive: true, force: true })
      removed.push(target)
    } catch (err) {
      console.warn('[main] no se pudo borrar', target, err)
    }
  }
  return removed
}
