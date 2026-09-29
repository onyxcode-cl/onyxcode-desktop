/**
 * Utilidades compartidas por los módulos de handlers de Tareas: registro tipado de un canal
 * `invoke` (con guard de esquema y envoltorio `IpcResult`) y el contexto que reciben los
 * submódulos (`tasks-*-handlers.ts`).
 */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type {
  TasksEventChannel,
  TasksEventContract,
  TasksInvokeChannel,
  TasksInvokeContract,
  TasksRequest,
  TasksResponse
} from '@shared/ipc-tasks'
import type { TasksManager } from '../tasks/manager'
import type { TasksProjectsStore } from '../tasks/projects'
import type { KeepAwakeService } from '../tasks/keep-awake'
import type { ComputerService } from '../computer/service'
import type { SchedulerService } from '../scheduler/service'
import { makeInvokeHandler } from './handle'

export type TasksHandler<C extends TasksInvokeChannel> = (
  req: TasksRequest<C>,
  event: IpcMainInvokeEvent
) => TasksResponse<C> | Promise<TasksResponse<C>>

const handle = makeInvokeHandler<TasksInvokeContract>({ withCode: true })

/** Devuelve un `handle(canal, fn)` ligado a `ipcMain`. */
export function makeTasksHandle(ipcMain: IpcMain): <C extends TasksInvokeChannel>(ch: C, fn: TasksHandler<C>) => void {
  return (ch, fn) => handle(ipcMain, ch, fn)
}

/** Contexto que `tasks-handlers.ts` entrega a cada submódulo de handlers. */
export interface TasksIpcContext {
  handle: <C extends TasksInvokeChannel>(ch: C, fn: TasksHandler<C>) => void
  /** Difunde un evento a todas las ventanas. */
  send: <C extends TasksEventChannel>(ch: C, payload: TasksEventContract[C]) => void
  getWindow: () => BrowserWindow | null
  tasks: TasksManager
  computer: ComputerService
  scheduler: SchedulerService
  projects: TasksProjectsStore
  keepAwake: KeepAwakeService
}

/** Cada `registerX(ctx)` devuelve esto; `dispose` se espera al apagar. */
export interface TasksSubmodule {
  dispose?: () => void | Promise<void>
}
