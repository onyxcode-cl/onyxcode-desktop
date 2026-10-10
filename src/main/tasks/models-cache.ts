/**
 * Catálogo de modelos para el servidor de una carpeta (sandbox).
 *
 * OpenCode guarda el catálogo (`models.json`) en `$XDG_CACHE_HOME/opencode` y lo descarga de internet. El servidor de
 * una carpeta tiene su PROPIO caché, vacío al crearse, y su salida a la red solo llega a los proveedores del usuario:
 * sin el catálogo, la primera tarea falla con «Model not found» aunque la clave sea válida. Se copia el del
 * servidor principal (datos públicos, sin claves) si el de la carpeta no existe o es más viejo.
 */
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Caché de OpenCode del servidor principal (el sin sandbox, que sí descarga el catálogo). */
export function mainOpencodeCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'opencode')
}

/**
 * Copia también los binarios que OpenCode descarga (`bin/rg`, ripgrep): sin salida a internet el servidor de la carpeta no
 * puede bajarlos y las skills fallaban («la skill no carga por un fallo de ripgrep»), con una tarjeta de permiso de carpeta
 * que no se puede conceder. Solo copia los que faltan.
 */
export function seedBinaries(folderCacheDir: string, mainCacheDir: string = mainOpencodeCacheDir()): boolean {
  try {
    const srcDir = join(mainCacheDir, 'bin')
    if (!existsSync(srcDir)) return false
    const destDir = join(folderCacheDir, 'opencode', 'bin')
    let copied = false
    for (const name of readdirSync(srcDir)) {
      const dest = join(destDir, name)
      if (existsSync(dest)) continue
      mkdirSync(destDir, { recursive: true })
      copyFileSync(join(srcDir, name), dest)
      chmodSync(dest, 0o755)
      copied = true
    }
    return copied
  } catch {
    return false
  }
}

/** Copia `models.json` del caché principal al de la carpeta. Devuelve true si copió. Nunca lanza. */
export function seedModelsCache(folderCacheDir: string, mainCacheDir: string = mainOpencodeCacheDir()): boolean {
  seedBinaries(folderCacheDir, mainCacheDir)
  try {
    const src = join(mainCacheDir, 'models.json')
    if (!existsSync(src)) return false
    const destDir = join(folderCacheDir, 'opencode')
    const dest = join(destDir, 'models.json')
    if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(src).mtimeMs) return false
    mkdirSync(destDir, { recursive: true })
    copyFileSync(src, dest)
    return true
  } catch {
    return false
  }
}
