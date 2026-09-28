import type { IpcRenderer, IpcRendererEvent } from 'electron'
import {
  COWORK_EVENT_CHANNELS,
  COWORK_INVOKE_CHANNELS,
  type CoworkApi,
  type CoworkEventChannel,
  type CoworkEventContract,
  type CoworkInvokeChannel
} from '@shared/ipc-cowork'
import type { IpcResult } from '@shared/ipc'

const invokeAllowed = new Set<string>(COWORK_INVOKE_CHANNELS)
const eventAllowed = new Set<string>(COWORK_EVENT_CHANNELS)

/** Construye `window.api.cowork` (canales `cowork:*`, `routines:*` y `computer:*`). */
export function buildCoworkApi(ipcRenderer: IpcRenderer): CoworkApi {
  return {
    invoke: ((channel: CoworkInvokeChannel, ...args: unknown[]): Promise<IpcResult<unknown>> => {
      if (!invokeAllowed.has(channel)) {
        return Promise.resolve({ ok: false, code: 'ERROR', error: `Canal IPC no permitido: ${channel}` })
      }
      return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<unknown>>
    }) as CoworkApi['invoke'],

    on<C extends CoworkEventChannel>(channel: C, listener: (payload: CoworkEventContract[C]) => void): () => void {
      if (!eventAllowed.has(channel)) throw new Error(`Evento IPC no permitido: ${channel}`)
      const wrapped = (_e: IpcRendererEvent, payload: CoworkEventContract[C]): void => listener(payload)
      ipcRenderer.on(channel, wrapped)
      return () => {
        ipcRenderer.removeListener(channel, wrapped)
      }
    }
  }
}
