/**
 * Canales `routines:*` (Rutinas). Los registra `tasks-handlers.ts` (macOS, con el gestor de Tareas) y,
 * fuera de macOS, `registerRoutinesHandlers`: un planificador SIN modo Tareas (Chat y Code) que no
 * importa nada de Seatbelt, proxy ni Control del PC.
 */
import { BrowserWindow, type IpcMain } from 'electron'
import type { TasksEventChannel, TasksEventContract } from '@shared/ipc-tasks'
import type { NotifyTarget } from '@shared/types'
import { previewSchedule } from '../scheduler/schedule'
import { noTasksPort } from '../scheduler/no-tasks-port'
import { SchedulerService, type SchedulerDeps } from '../scheduler/service'
import { settingsStore } from '../store'
import { makeTasksHandle } from './tasks-handle'

type TasksHandle = ReturnType<typeof makeTasksHandle>

/** Registra los siete canales `routines:*` sobre un planificador ya creado. */
export function registerRoutineChannels(handle: TasksHandle, scheduler: SchedulerService): void {
  handle('routines:list', () => scheduler.list())
  handle('routines:save', (input) => scheduler.saveRoutine(input))
  handle('routines:delete', ({ id }) => scheduler.delete(id))
  handle('routines:toggle', ({ id, enabled }) => scheduler.toggle(id, enabled))
  handle('routines:runNow', ({ id }) => scheduler.runNow(id))
  handle('routines:history', (req) => scheduler.history(req?.id, req?.limit))
  handle('routines:preview', ({ schedule }) => previewSchedule(schedule, 3))
}

export interface RoutinesHandlerDeps {
  /** Conexión al sidecar principal (p.ej. `() => server.start()`). */
  getMainConnection: SchedulerDeps['getMainConnection']
  /** userData/chat-workspace. */
  chatDirectory: string
}

export interface RoutinesModule {
  scheduler: SchedulerService
  shutdown: () => Promise<void>
  busyTaskCount: () => number
  killSync: () => void
}

/** Rutinas sin modo Tareas (plataformas distintas de macOS). */
export function registerRoutinesHandlers(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  deps: RoutinesHandlerDeps
): RoutinesModule {
  const openTarget = (target: NotifyTarget): void => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    if (!win.webContents.isDestroyed()) win.webContents.send('app:openTarget', target)
  }
  const scheduler = new SchedulerService({
    getMainConnection: deps.getMainConnection,
    chatDirectory: deps.chatDirectory,
    tasks: noTasksPort,
    tasksSupported: false,
    getSettings: () => settingsStore.get(),
    openTarget
  })
  const send = <C extends TasksEventChannel>(channel: C, payload: TasksEventContract[C]): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.webContents.isDestroyed()) win.webContents.send(channel, payload)
    }
  }
  scheduler.on('changed', (list) => send('routines:changed', list))
  scheduler.on('run', (run) => send('routines:run', run))
  registerRoutineChannels(makeTasksHandle(ipcMain), scheduler)
  scheduler.start()
  return {
    scheduler,
    shutdown: async () => scheduler.stop(),
    busyTaskCount: () => 0,
    killSync: () => undefined
  }
}
