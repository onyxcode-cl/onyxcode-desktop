import type { IpcRenderer, IpcRendererEvent } from 'electron'
import {
  BROWSER_EVENT_CHANNELS,
  BROWSER_INVOKE_CHANNELS,
  type BrowserApi,
  type BrowserEventChannel,
  type BrowserInvokeChannel,
  type IpcBrowserResult
} from '@shared/ipc-browser'

const invokeAllowed = new Set<string>(BROWSER_INVOKE_CHANNELS)
const eventAllowed = new Set<string>(BROWSER_EVENT_CHANNELS)

/** Construye `window.api.browser`. Uso en preload/index.ts y preload/browser-host.ts. */
export function buildBrowserApi(ipcRenderer: IpcRenderer): BrowserApi {
  const invoke = async (channel: BrowserInvokeChannel, ...args: unknown[]): Promise<unknown> => {
    if (!invokeAllowed.has(channel)) throw new Error(`Canal IPC no permitido: ${channel}`)
    const result = (await ipcRenderer.invoke(channel, ...args)) as IpcBrowserResult<unknown>
    if (!result.ok) throw new Error(result.error)
    return result.data
  }

  const on = (channel: BrowserEventChannel, listener: (payload: unknown) => void): (() => void) => {
    if (!eventAllowed.has(channel)) throw new Error(`Evento IPC no permitido: ${channel}`)
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => {
      ipcRenderer.removeListener(channel, wrapped)
    }
  }

  return {
    invoke: invoke as BrowserApi['invoke'],
    on: on as BrowserApi['on']
  }
}
