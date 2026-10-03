import { contextBridge, ipcRenderer } from 'electron'
import { IPC_EVENT_CHANNELS, IPC_INVOKE_CHANNELS, type IpcEventChannel, type IpcInvokeChannel, type WindowApi } from '@shared/ipc'
import { makeBridge } from './bridge'
import { buildBrowserApi } from './browser-api'
import { buildCodeApi } from './code-api'
import { buildTasksApi } from './tasks-api'
import { buildExtrasApi } from './extras-api'
import { buildRemoteApi } from './remote-api'

const bridge = makeBridge<IpcInvokeChannel, IpcEventChannel>(ipcRenderer, {
  invoke: IPC_INVOKE_CHANNELS,
  events: IPC_EVENT_CHANNELS
})

const api: WindowApi = {
  invoke: bridge.invokeRaw as WindowApi['invoke'],
  on: bridge.on as WindowApi['on'],
  platform: process.platform,
  code: buildCodeApi(ipcRenderer),
  tasks: buildTasksApi(ipcRenderer),
  extras: buildExtrasApi(ipcRenderer),
  browser: buildBrowserApi(ipcRenderer),
  remote: buildRemoteApi(ipcRenderer)
}

contextBridge.exposeInMainWorld('api', api)
