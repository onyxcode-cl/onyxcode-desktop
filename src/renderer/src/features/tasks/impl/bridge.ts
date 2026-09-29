/** Acceso tipado a `window.api.tasks` (canales `cowork:*` y `routines:*`). */
import type { IpcResult, WindowApi } from '@shared/ipc'
import type {
  CoworkApi,
  CoworkEventChannel,
  CoworkEventContract,
  CoworkInvokeChannel,
  CoworkRequest,
  CoworkResponse
} from '@shared/ipc-tasks'

function getApi(): CoworkApi {
  const api = (window as unknown as { api?: WindowApi & { tasks?: CoworkApi } }).api?.tasks
  if (!api) throw new Error('El puente de las tareas no está disponible (falta window.api.tasks en el preload).')
  return api
}

export function hasCoworkBridge(): boolean {
  return !!(window as unknown as { api?: { tasks?: unknown } }).api?.tasks
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

export function onCowork<C extends CoworkEventChannel>(channel: C, listener: (payload: CoworkEventContract[C]) => void): () => void {
  if (!hasCoworkBridge()) return () => undefined
  return getApi().on(channel, listener)
}
