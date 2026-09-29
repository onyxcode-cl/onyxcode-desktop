import {
  TASKS_EVENT_CHANNELS,
  TASKS_INVOKE_CHANNELS,
  type TasksApi,
  type TasksEventChannel,
  type TasksInvokeChannel
} from '@shared/ipc-tasks'
import type { IpcRenderer } from 'electron'
import { makeBridge } from './bridge'

/** Construye `window.api.tasks` (canales `tasks:*`, `routines:*` y `computer:*`). */
export function buildTasksApi(ipcRenderer: IpcRenderer): TasksApi {
  const bridge = makeBridge<TasksInvokeChannel, TasksEventChannel>(ipcRenderer, {
    invoke: TASKS_INVOKE_CHANNELS,
    events: TASKS_EVENT_CHANNELS
  })
  return {
    invoke: bridge.invokeRaw as TasksApi['invoke'],
    on: bridge.on as TasksApi['on']
  }
}
