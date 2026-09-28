import type { IpcInvokeChannel, IpcRequest, IpcResponse, IpcResult } from '@shared/ipc'

/** Puente tipado expuesto por el preload. */
export const api = window.api

export class IpcCallError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

export function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data
  throw new IpcCallError(result.code, result.error)
}

/** `invoke` que devuelve el dato directamente o lanza `IpcCallError`. */
export async function call<C extends IpcInvokeChannel>(
  channel: C,
  ...args: IpcRequest<C> extends void ? [] : [req: IpcRequest<C>]
): Promise<IpcResponse<C>> {
  return unwrap(await api.invoke(channel, ...args))
}
