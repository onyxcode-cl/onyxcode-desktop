/**
 * Catálogo de modelos del motor (`models.json` en `$XDG_CACHE_HOME/opencode`, bajado de internet al arrancar).
 *
 * El motor baja el catálogo por su cuenta nada más arrancar, pero si le piden la lista de proveedores ANTES de que termine (y no
 * hay caché de una vez anterior) se queda con su lista de respaldo incluida en el binario hasta que se reinicia: sin los modelos
 * gratuitos más nuevos (p. ej. `deepseek-v4.1-flash-free`). Pasa en el primer arranque con la caché vacía y en cualquier perfil
 * cuya caché falte. Descartar las instancias (`/global/dispose`, `/instance/dispose`) no lo arregla. Por eso la app no da el
 * motor por listo (no pide nada) hasta que aparece el archivo, con un tope para el caso sin red.
 */
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Tope de espera (sin red el archivo no llega nunca: el arranque no se retrasa más que esto). */
export const CATALOG_WAIT_MS = 6000

/** Ruta de `models.json` que usará el motor con este entorno (`OPENCODE_MODELS_PATH` manda si existe). */
export function catalogFile(env: Record<string, string | undefined>): string {
  if (env.OPENCODE_MODELS_PATH) return env.OPENCODE_MODELS_PATH
  const cache = env.XDG_CACHE_HOME || join(env.HOME || homedir(), '.cache')
  return join(cache, 'opencode', 'models.json')
}

function hasContent(file: string): boolean {
  try {
    return existsSync(file) && statSync(file).size > 0
  } catch {
    return false
  }
}

export interface CatalogWaitOptions {
  timeoutMs?: number
  intervalMs?: number
  /** Para pruebas. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  exists?: (file: string) => boolean
}

/**
 * Espera a que exista el catálogo. `present` = ya estaba (el motor lo lee al arrancar), `appeared` = lo bajó mientras esperábamos,
 * `timeout` = no llegó (sin red o red lenta: se sigue adelante, el motor usará su lista de respaldo hasta el próximo arranque).
 */
export async function waitForCatalog(file: string, o: CatalogWaitOptions = {}): Promise<'present' | 'appeared' | 'timeout'> {
  const exists = o.exists ?? hasContent
  if (exists(file)) return 'present'
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = o.now ?? Date.now
  const deadline = now() + (o.timeoutMs ?? CATALOG_WAIT_MS)
  while (now() < deadline) {
    await sleep(o.intervalMs ?? 100)
    if (exists(file)) {
      await sleep(150) // que termine de escribirse
      return 'appeared'
    }
  }
  return 'timeout'
}
