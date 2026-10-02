/**
 * Puerto de Tareas vacío para plataformas sin modo Tareas (Windows en la v1): el planificador sigue
 * funcionando para Chat y Code, y nada de Seatbelt/proxy/gestor de Tareas se carga. Las rutinas en
 * modo Tareas se rechazan antes de llegar aquí (`SchedulerDeps.tasksSupported === false`); si algo
 * lo llamara igualmente, `start` falla con un mensaje claro y el resto responde «no».
 */
import { t } from '@shared/i18n'
import type { TasksFolderSet } from '@shared/ipc-tasks'
import type { RoutineTasksPort } from './service'

export const noTasksPort: RoutineTasksPort = {
  isApproved: () => false,
  hasFullAccessGrant: () => false,
  start: () => Promise.reject(new Error(t('merr.routine.platformUnsupported'))),
  folderSet: (folder): TasksFolderSet => ({ primary: folder, linked: [], trusted: [], applied: true }),
  networkAllowOnce: () => undefined,
  network: { hasOnce: () => false, revokeOnce: () => undefined },
  on: () => undefined,
  off: () => undefined
}
