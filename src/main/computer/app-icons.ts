/**
 * Icono real de una app para la tarjeta de permiso («¿Permitir que Lazunox use Spotify?»). Se resuelve en main y viaja como
 * data URL PNG pequeño en `AccessRequestApp.icon`. Falla SIEMPRE a «sin icono» (nunca rompe la tarjeta).
 *  - macOS: bundleId (validado con regex estricta) → ruta de la .app con `mdfind` (execFile, sin shell) → icono del archivo.
 *  - Windows: la clave de la app (`exe:<ruta>|pub:…`) ya trae la ruta del .exe (`parseAppKey`); las apps UWP (`aumid:`) no
 *    tienen ruta y quedan sin icono (la tarjeta cae al nombre).
 * Este módulo no importa electron: la parte nativa (`getFileIcon`) se inyecta desde `tasks-computer-wiring.ts`.
 */
import { isSafeIconDataUrl } from '@shared/app-icon'
import { parseAppKey } from './policy/app-key'

const CACHE_MAX = 64
const BUNDLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export interface AppIconDeps {
  platform: string
  /** Busca la .app de un bundleId ya validado (macOS). `null` = no se encontró. */
  findMacAppPath: (bundleId: string) => Promise<string | null>
  /** PNG del icono del archivo ya reducido, como data URL (la parte con electron). */
  fileIconDataUrl: (path: string) => Promise<string | null>
}

export function createAppIconResolver(deps: AppIconDeps): (appKey: string) => Promise<string | undefined> {
  const cache = new Map<string, string | null>()
  const byPath = new Map<string, string | null>()
  const remember = (k: string, v: string | null): void => {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
    cache.set(k, v)
  }
  return async (appKey) => {
    if (typeof appKey !== 'string' || appKey.length > 600) return undefined
    if (cache.has(appKey)) return cache.get(appKey) ?? undefined
    let icon: string | null = null
    try {
      let path: string | null = null
      if (deps.platform === 'win32') {
        const parsed = parseAppKey(appKey)
        path = parsed?.kind === 'exe' ? parsed.path : null
      } else if (deps.platform === 'darwin' && BUNDLE_ID_RE.test(appKey)) {
        path = await deps.findMacAppPath(appKey)
      }
      if (path) {
        if (byPath.has(path)) icon = byPath.get(path) ?? null
        else {
          const url = await deps.fileIconDataUrl(path)
          icon = isSafeIconDataUrl(url) ? url : null
          if (byPath.size >= CACHE_MAX) byPath.delete(byPath.keys().next().value as string)
          byPath.set(path, icon)
        }
      }
    } catch (err) {
      console.warn('[computer] icono de app:', err instanceof Error ? err.message : err)
      icon = null
    }
    remember(appKey, icon)
    return icon ?? undefined
  }
}
