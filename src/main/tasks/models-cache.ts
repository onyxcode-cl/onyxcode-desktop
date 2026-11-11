/**
 * Catálogo de modelos para el servidor de una carpeta (sandbox).
 *
 * OpenCode guarda el catálogo (`models.json`) en `$XDG_CACHE_HOME/opencode` y lo descarga de internet. El servidor de
 * una carpeta tiene su PROPIO caché, vacío al crearse, y su salida a la red solo llega a los proveedores del usuario:
 * sin el catálogo, la primera tarea falla con «Model not found» aunque la clave sea válida. Se copia el del
 * servidor principal (datos públicos, sin claves) si el de la carpeta no existe o es más viejo.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureRealDir, isRealDir, writeFileNoFollow } from './no-follow'

/** Caché de OpenCode del servidor principal (el sin sandbox, que sí descarga el catálogo). */
export function mainOpencodeCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'opencode')
}

/**
 * Copia también los binarios que OpenCode descarga (`bin/rg`, ripgrep): sin salida a internet el servidor de la carpeta no
 * puede bajarlos y las skills fallaban («la skill no carga por un fallo de ripgrep»), con una tarjeta de permiso de carpeta
 * que no se puede conceder. Solo copia los que faltan.
 *
 * 1.8.18: esto corre en el proceso principal (FUERA del encierro) y escribe en la carpeta privada de la tarea, que la tarea controla.
 * Nunca se sigue un enlace: `cache` tiene que ser una carpeta real, `opencode` y `opencode/bin` se comprueban tramo a tramo (un enlace
 * se borra, no su destino, y se crea la carpeta) y cada archivo se escribe con `O_NOFOLLOW` (un enlace en su lugar se borra y se
 * escribe un archivo nuevo). Antes, `opencode/bin` → otra carpeta dejaba un `rg` ejecutable en esa carpeta.
 */
export function seedBinaries(folderCacheDir: string, mainCacheDir: string = mainOpencodeCacheDir()): boolean {
  try {
    const srcDir = join(mainCacheDir, 'bin')
    if (!existsSync(srcDir)) return false
    if (!isRealDir(folderCacheDir)) return false
    const destDir = join(folderCacheDir, 'opencode', 'bin')
    let copied = false
    for (const name of readdirSync(srcDir)) {
      const dest = join(destDir, name)
      ensureRealDir(folderCacheDir, destDir, { create: true, replace: true })
      const st = lstatOrNull(dest)
      if (st && st.isFile() && !st.isSymbolicLink() && st.nlink === 1) continue // ya está (archivo normal propio)
      writeFileNoFollow(dest, readFileSync(join(srcDir, name)), { mode: 0o755, replace: true })
      copied = true
    }
    return copied
  } catch {
    return false
  }
}

/** Copia `models.json` del caché principal al de la carpeta. Devuelve true si copió. Nunca lanza. Sin seguir enlaces (ver `seedBinaries`). */
export function seedModelsCache(folderCacheDir: string, mainCacheDir: string = mainOpencodeCacheDir()): boolean {
  seedBinaries(folderCacheDir, mainCacheDir)
  try {
    const src = join(mainCacheDir, 'models.json')
    if (!existsSync(src)) return false
    if (!isRealDir(folderCacheDir)) return false
    const destDir = ensureRealDir(folderCacheDir, join(folderCacheDir, 'opencode'), { create: true, replace: true })
    const dest = join(destDir, 'models.json')
    // `lstat`, no `stat`: la fecha de un enlace no cuenta (antes, un enlace a un archivo del usuario más viejo que el catálogo hacía
    // que se sobrescribiera ESE archivo).
    const st = lstatOrNull(dest)
    if (st && st.isFile() && !st.isSymbolicLink() && st.nlink === 1 && st.mtimeMs >= statSync(src).mtimeMs) return false
    writeFileNoFollow(dest, readFileSync(src), { replace: true })
    return true
  } catch {
    return false
  }
}

function lstatOrNull(p: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}

/** Subcarpeta de la config de la app donde el backend WSL deja la copia del catálogo (solo lectura para el servidor). */
export const CONFIG_CATALOG_DIR = 'catalogo'

/**
 * Backend WSL (Windows): el servidor de la carpeta vive en una distro cuyo caché (`/home/lazunox/xdg/<clave>/cache`) no se
 * puede escribir desde Windows, así que el catálogo viaja por la carpeta de config (ya montada de solo lectura) y el servidor
 * lo lee con `OPENCODE_MODELS_PATH`. Copia `models.json` del caché principal a `<configDir>/catalogo/models.json` (si falta
 * o es más viejo) y devuelve la ruta de Windows del archivo, o null si no hay catálogo. Nunca lanza.
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
