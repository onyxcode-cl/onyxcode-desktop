import {
  BROWSER_EVENT_CHANNELS,
  BROWSER_INVOKE_CHANNELS,
  type BrowserApi,
  type BrowserEventChannel,
  type BrowserInvokeChannel
} from '@shared/ipc-browser'
import type { IpcRenderer } from 'electron'
import { makeBridge } from './bridge'

/** Construye `window.api.browser`. Solo para preload/index.ts (browser-host.ts es autocontenido). */
export function buildBrowserApi(ipcRenderer: IpcRenderer): BrowserApi {
  const bridge = makeBridge<BrowserInvokeChannel, BrowserEventChannel>(ipcRenderer, {
    invoke: BROWSER_INVOKE_CHANNELS,
    events: BROWSER_EVENT_CHANNELS
  })
  return {
    invoke: bridge.invokeUnwrap as BrowserApi['invoke'],
    on: bridge.on as BrowserApi['on']
  }
}
