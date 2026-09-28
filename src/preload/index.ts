import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC_EVENT_CHANNELS,
  IPC_INVOKE_CHANNELS,
  type IpcEventChannel,
  type IpcEventContract,
  type IpcInvokeChannel,
  type IpcResult,
  type WindowApi
} from '@shared/ipc'

const invokeAllowed = new Set<string>(IPC_INVOKE_CHANNELS)
const eventAllowed = new Set<string>(IPC_EVENT_CHANNELS)

const api: WindowApi = {
  invoke: ((channel: IpcInvokeChannel, ...args: unknown[]): Promise<IpcResult<unknown>> => {
    if (!invokeAllowed.has(channel)) {
      return Promise.resolve({ ok: false, code: 'ERROR', error: `Canal IPC no permitido: ${channel}` })
    }
    return ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<unknown>>
  }) as WindowApi['invoke'],

  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventContract[C]) => void): () => void {
    if (!eventAllowed.has(channel)) throw new Error(`Evento IPC no permitido: ${channel}`)
    const wrapped = (_event: IpcRendererEvent, payload: IpcEventContract[C]): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  },

  platform: process.platform
}

contextBridge.exposeInMainWorld('api', api)
