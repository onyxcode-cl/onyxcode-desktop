/**
 * Catálogo de modelos para el servidor de una carpeta (sandbox).
 *
 * OpenCode guarda el catálogo (`models.json`) en `$XDG_CACHE_HOME/opencode` y lo descarga de internet. El servidor de
 * una carpeta tiene su PROPIO caché, vacío al crearse, y su salida a la red solo llega a los proveedores del usuario:
 * sin el catálogo, la primera tarea falla con «Model not found» aunque la clave sea válida. Se copia el del
 * servidor principal (datos públicos, sin claves) a la config de la app y el servidor lo lee con `OPENCODE_MODELS_PATH`.
 *
 * 1.8.18 (corrección tras la revisión 1): macOS hace lo mismo que WSL. Antes se copiaba a la caché PRIVADA de la tarea
 * (`seedModelsCache`, y `seedBinaries` copiaba `bin/rg`), que la tarea controla: un proceso suyo podía cambiar `cache/opencode` por un
 * enlace mientras el proceso principal escribía. Ya no se escribe nada ahí; el `rg` incluido va en el PATH del motor (1.8.17).
 */
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Caché de OpenCode del servidor principal (el sin sandbox, que sí descarga el catálogo). */
export function mainOpencodeCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'opencode')
}

/** Subcarpeta de la config de la app donde los backends WSL y Seatbelt dejan la copia del catálogo (solo lectura para el servidor). */
export const CONFIG_CATALOG_DIR = 'catalogo'

/**
 * Backend WSL (Windows) y Seatbelt (macOS, 1.8.18): el catálogo viaja por la carpeta de config de la app (de solo lectura para el
 * servidor de la tarea; en WSL su caché ni siquiera se puede escribir desde Windows) y el servidor lo lee con `OPENCODE_MODELS_PATH`.
 * Copia `models.json` del caché principal a `<configDir>/catalogo/models.json` (si falta o es más viejo) y devuelve la ruta (del
 * sistema anfitrión) del archivo, o null si no hay catálogo. Nunca lanza. `configDir` está en `userData`: la tarea no puede escribirla.
 */
export function seedConfigModels(configDir: string, mainCacheDir: string = mainOpencodeCacheDir()): string | null {
  try {
    const src = join(mainCacheDir, 'models.json')
    if (!existsSync(src)) return null
    const destDir = join(configDir, CONFIG_CATALOG_DIR)
    const dest = join(destDir, 'models.json')
    if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) {
      mkdirSync(destDir, { recursive: true })
      copyFileSync(src, dest)
    }
    return dest
  } catch {
    return null
  }
}
