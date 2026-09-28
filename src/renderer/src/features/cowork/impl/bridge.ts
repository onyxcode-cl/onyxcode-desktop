/** Acceso tipado a `window.api.cowork` (canales `cowork:*` y `routines:*`). */
import type { IpcResult, WindowApi } from '@shared/ipc'
import type {
  CoworkApi,
  CoworkEventChannel,
  CoworkEventContract,
  CoworkInvokeChannel,
  CoworkRequest,
  CoworkResponse
} from '@shared/ipc-cowork'

function getApi(): CoworkApi {
  const api = (window as unknown as { api?: WindowApi & { cowork?: CoworkApi } }).api?.cowork
  if (!api) throw new Error('El puente de Cowork no está disponible (falta window.api.cowork en el preload).')
  return api
}

export function hasCoworkBridge(): boolean {
  return !!(window as unknown as { api?: { cowork?: unknown } }).api?.cowork
}

function unwrap<T>(r: IpcResult<T>): T {
  if (r.ok) return r.data
  throw new Error(r.error)
}

/** `invoke` que devuelve el dato o lanza `Error`. */
export async function cw<C extends CoworkInvokeChannel>(
  channel: C,
  ...args: CoworkRequest<C> extends void ? [] : [req: CoworkRequest<C>]
): Promise<CoworkResponse<C>> {
  return unwrap(await getApi().invoke(channel, ...args))
}

export function onCowork<C extends CoworkEventChannel>(
  channel: C,
  listener: (payload: CoworkEventContract[C]) => void
): () => void {
  if (!hasCoworkBridge()) return () => undefined
  return getApi().on(channel, listener)
}
