import type { IpcRenderer } from 'electron'
import {
  REMOTE_EVENT_CHANNELS,
  REMOTE_INVOKE_CHANNELS,
  type RemoteApi,
  type RemoteEventChannel,
  type RemoteInvokeChannel
} from '@shared/ipc-remote'
import { makeBridge } from './bridge'

/** Construye `window.api.remote`. Solo para preload/index.ts. */
export function buildRemoteApi(ipcRenderer: IpcRenderer): RemoteApi {
  const bridge = makeBridge<RemoteInvokeChannel, RemoteEventChannel>(ipcRenderer, {
    invoke: REMOTE_INVOKE_CHANNELS,
    events: REMOTE_EVENT_CHANNELS
  })
  return {
    invoke: bridge.invokeUnwrap as RemoteApi['invoke'],
    on: bridge.on as RemoteApi['on']
  }
}
