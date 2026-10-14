/**
 * Handlers de la revisión de arranque (`preflight:*`). La lógica vive en `main/preflight`; aquí solo se conecta al IPC y se le
 * entregan el servicio de Control del PC y el estado del entorno aislado, que se crean en este módulo de Tareas.
 */
import type { TasksSandboxStatus } from '@shared/ipc-tasks'
import type { ComputerService } from '../computer/service'
import { configurePreflight, reportPreflightFailure, runPreflight } from '../preflight/real'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export function registerTasksPreflightHandlers(
  ctx: TasksIpcContext,
  o: { computer?: ComputerService; sandboxStatus: () => Promise<TasksSandboxStatus> }
): TasksSubmodule {
  configurePreflight({ computer: o.computer, sandboxStatus: o.sandboxStatus })
  ctx.handle('preflight:run', () => runPreflight())
  ctx.handle('preflight:fail', (req) => reportPreflightFailure(req))
  return {}
}
