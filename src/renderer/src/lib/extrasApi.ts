/** Acceso al puente `window.api.extras` (sin dependencias de features). */
import type { ExtrasApi } from '@shared/ipc-extras'

/** `window.api.extras` o null si el preload aún no lo expone (o si no hay `window` — algunas
 * pruebas de contenido renderizan con `renderToStaticMarkup`, un SSR de verdad sin `window` global). */
export function getExtras(): ExtrasApi | null {
  if (typeof window === 'undefined') return null
  return (window as unknown as { api?: { extras?: ExtrasApi } }).api?.extras ?? null
}

export function requireExtras(): ExtrasApi {
  const e = getExtras()
  if (!e) throw new Error('El puente "extras" no está disponible (falta registrar buildExtrasApi en el preload).')
  return e
}
