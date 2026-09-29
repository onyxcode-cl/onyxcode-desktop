/**
 * Handlers de carpetas adicionales, carpetas de confianza y política gestionada
 * (`tasks:folders:*`, `tasks:trusted:*`, `tasks:policy`). La lógica vive en `TasksManager`
 * (carpetas) y `policy.ts` (política); aquí solo se conectan al IPC.
 */
import { loadManagedPolicy } from '../tasks/policy'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

export function registerTasksFoldersHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle, tasks } = ctx
  handle('tasks:folders:get', ({ folder }) => tasks.folderSet(folder))
  handle('tasks:folders:check', ({ path }) => tasks.checkFolder(path))
  // `restart !== false` reinicia SOLO si el servidor sandbox del espacio está vivo (`restarted`).
  handle('tasks:folders:link', ({ folder, path, mode, trust, restart }) => tasks.linkFolder(folder, path, mode, { trust, restart }))
  handle('tasks:folders:unlink', ({ folder, path, restart }) => tasks.unlinkFolder(folder, path, { restart }))
  handle('tasks:trusted:list', () => tasks.trustedList())
  handle('tasks:trusted:set', ({ path, mode }) => tasks.setTrusted(path, mode))
  handle('tasks:trusted:remove', ({ path }) => tasks.removeTrusted(path))
  handle('tasks:policy', () => loadManagedPolicy())
  return {}
}
