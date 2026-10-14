/**
 * Handlers `tasks:sandbox:*`: estado e instalación del entorno aislado de Tareas (en Windows, la distro propia).
 * La lógica vive en `TasksSandboxService`; aquí solo se conectan al IPC y a la bandera `tasksWin`.
 */
import { selectBackend, type WinBackendProvider } from '../tasks/backends'
import { seatbeltAvailable } from '../tasks/backends/seatbelt'
import { TasksSandboxService } from '../tasks/sandbox-service'
import type { TasksSandboxStatus } from '@shared/ipc-tasks'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export interface TasksSandboxModule extends TasksSubmodule {
  /** Estado del entorno aislado (lo usa también la revisión de arranque). */
  status: () => Promise<TasksSandboxStatus>
}

export function registerTasksSandboxHandlers(
  ctx: TasksIpcContext,
  o: { tasksWin?: boolean; winBackend?: WinBackendProvider }
): TasksSandboxModule {
  const { handle, send } = ctx
  const service = new TasksSandboxService({
    platform: process.platform,
    seatbeltReady: seatbeltAvailable,
    tasksWin: o.tasksWin,
    // `purpose: 'setup'`: preparar/consultar la distro no exige aún `state.json` (la primera instalación no lo tiene). Arrancar un
    // servidor (`startTasksServer`) NO pasa propósito y usa el estricto `run`. Este backend se recuerda tras el primer éxito:
    // sirve para el estado y la preparación, jamás para lanzar tareas.
    getBackend: () => selectBackend(process.platform, { tasksWin: o.tasksWin, win: o.winBackend, purpose: 'setup' }),
    emit: (s) => send('tasks:sandbox:progress', s)
  })
  handle('tasks:sandbox:status', (req) => service.status({ force: req?.force === true }))
  handle('tasks:sandbox:setup', () => service.setup())
  handle('tasks:sandbox:cancel', () => service.cancel())
  return {
    status: () => service.status(),
    dispose: async () => {
      await service.cancel()
      await Promise.race([service.idle(), new Promise<void>((r) => setTimeout(r, 3_000).unref?.())])
    }
  }
}
