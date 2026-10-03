import type { IpcRenderer } from 'electron'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS, type IpcEventChannel, type IpcInvokeChannel, type WindowApi } from '@shared/ipc'
import { makeBridge } from './bridge'
import { buildBrowserApi } from './browser-api'
import { buildCodeApi } from './code-api'
import { buildTasksApi } from './tasks-api'
import { buildExtrasApi } from './extras-api'
import { buildRemoteApi } from './remote-api'

/**
 * Arma el objeto `window.api` completo a partir de un `ipcRenderer`. Solo bundle `index.js`: lo usa el preload de la ventana
 * principal (con el `ipcRenderer` de Electron) y la PWA del celular (`src/renderer/remote`, con uno que habla por el
 * DataChannel), de modo que las dos interfaces tienen exactamente la misma forma.
 */
export function buildWindowApi(ipcRenderer: IpcRenderer, platform: string): WindowApi {
  const bridge = makeBridge<IpcInvokeChannel, IpcEventChannel>(ipcRenderer, {
    invoke: IPC_INVOKE_CHANNELS,
    events: IPC_EVENT_CHANNELS
  })
  return {
    invoke: bridge.invokeRaw as WindowApi['invoke'],
    on: bridge.on as WindowApi['on'],
    platform,
    code: buildCodeApi(ipcRenderer),
    tasks: buildTasksApi(ipcRenderer),
    extras: buildExtrasApi(ipcRenderer),
    browser: buildBrowserApi(ipcRenderer),
    remote: buildRemoteApi(ipcRenderer)
  }
}
