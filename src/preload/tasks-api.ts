import {
  COWORK_EVENT_CHANNELS,
  COWORK_INVOKE_CHANNELS,
  type CoworkApi,
  type CoworkEventChannel,
  type CoworkInvokeChannel
} from '@shared/ipc-tasks'
import type { IpcRenderer } from 'electron'
import { makeBridge } from './bridge'

/** Construye `window.api.tasks` (canales `cowork:*`, `routines:*` y `computer:*`). */
export function buildCoworkApi(ipcRenderer: IpcRenderer): CoworkApi {
  const bridge = makeBridge<CoworkInvokeChannel, CoworkEventChannel>(ipcRenderer, {
    invoke: COWORK_INVOKE_CHANNELS,
    events: COWORK_EVENT_CHANNELS
  })
  return {
    invoke: bridge.invokeRaw as CoworkApi['invoke'],
    on: bridge.on as CoworkApi['on']
  }
}
