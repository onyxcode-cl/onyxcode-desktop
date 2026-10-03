import { api, call } from './api'
import { platformCaps } from './platform'

/** Solo `http(s)`: nada de `javascript:`, `file:` ni esquemas del sistema. */
const isWebUrl = (url: string): boolean => /^https?:\/\//i.test(url)

/**
 * Abre un enlace fuera de la app. En el escritorio, `app:openExternal` (lo abre el Mac con su navegador). En la PWA del celular
 * ese canal no existe (el Mac no abre cosas por orden del celular): se abre en una pestaña nueva del propio navegador del celular.
 */
export function openExternalUrl(url: string): Promise<unknown> {
  if (platformCaps().openExternal) return api.invoke('app:openExternal', { url })
  if (isWebUrl(url)) window.open(url, '_blank', 'noopener,noreferrer')
  return Promise.resolve()
}

/** Como `openExternalUrl`, pero lanza si el escritorio rechaza la orden (flujo de acceso con proveedor). */
export async function openExternalUrlStrict(url: string): Promise<void> {
  if (platformCaps().openExternal) await call('app:openExternal', { url })
  else await openExternalUrl(url)
}
