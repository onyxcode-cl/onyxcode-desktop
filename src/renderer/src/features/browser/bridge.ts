/**
 * Acceso tipado a `window.api.browser` (canales `browser:*`). A diferencia de Tareas/Code,
 * `BrowserApi.invoke` ya lanza `Error` en vez de envolver la respuesta en `IpcResult`
 * (ver `src/shared/ipc-browser.ts`), así que aquí no hace falta `unwrap`.
 */
import type { WindowApi } from '@shared/ipc'
import { t } from '@shared/i18n'
import { platformCaps } from '../../lib/platform'
import type {
  BrowserApi,
  BrowserEventChannel,
  BrowserEventContract,
  BrowserInvokeChannel,
  BrowserRequest,
  BrowserResponse
} from '@shared/ipc-browser'

function getApi(): BrowserApi {
  const api = (window as unknown as { api?: WindowApi & { browser?: BrowserApi } }).api?.browser
  if (!api) throw new Error(t('browser.bridgeMissing'))
  return api
}

export function hasBrowserBridge(): boolean {
  // Sin vista nativa del navegador (PWA del celular) no hay navegador integrado, aunque `window.api.browser` exista.
  return platformCaps().nativeBrowser && !!(window as unknown as { api?: { browser?: unknown } }).api?.browser
}

/** `invoke` tipado hacia `browser:*`. Lanza `Error` si main falla. */
export async function br<C extends BrowserInvokeChannel>(
  channel: C,
  ...args: BrowserRequest<C> extends void ? [] : [req: BrowserRequest<C>]
): Promise<BrowserResponse<C>> {
  return getApi().invoke(channel, ...args)
}

/** Suscribe a un evento `browser:*`. Sin puente disponible, no hace nada (devuelve un no-op). */
export function onBrowser<C extends BrowserEventChannel>(channel: C, listener: (payload: BrowserEventContract[C]) => void): () => void {
  if (!hasBrowserBridge()) return () => undefined
  return getApi().on(channel, listener)
}
