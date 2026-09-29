/** Acceso tipado a `window.api.tasks` (canales `tasks:*` y `routines:*`). */
import type { IpcResult, WindowApi } from '@shared/ipc'
import type {
  TasksApi,
  TasksEventChannel,
  TasksEventContract,
  TasksInvokeChannel,
  TasksRequest,
  TasksResponse
} from '@shared/ipc-tasks'

function getApi(): TasksApi {
  const api = (window as unknown as { api?: WindowApi & { tasks?: TasksApi } }).api?.tasks
  if (!api) throw new Error('El puente de las tareas no está disponible (falta window.api.tasks en el preload).')
  return api
}

export function hasTasksBridge(): boolean {
  return !!(window as unknown as { api?: { tasks?: unknown } }).api?.tasks
}

function unwrap<T>(r: IpcResult<T>): T {
  if (r.ok) return r.data
  throw new Error(r.error)
}

/** `invoke` que devuelve el dato o lanza `Error`. */
export async function cw<C extends TasksInvokeChannel>(
  channel: C,
  ...args: TasksRequest<C> extends void ? [] : [req: TasksRequest<C>]
): Promise<TasksResponse<C>> {
  return unwrap(await getApi().invoke(channel, ...args))
}

export function onTasks<C extends TasksEventChannel>(channel: C, listener: (payload: TasksEventContract[C]) => void): () => void {
  if (!hasTasksBridge()) return () => undefined
  return getApi().on(channel, listener)
}
