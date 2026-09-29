/**
 * Handlers de carpetas adicionales, carpetas de confianza y política gestionada
 * (`tasks:folders:*`, `tasks:trusted:*`, `tasks:policy`). La lógica vive en `CoworkManager`
 * (carpetas) y `policy.ts` (política); aquí solo se conectan al IPC.
 */
import { loadManagedPolicy } from '../cowork/policy'
import type { CoworkIpcContext, CoworkSubmodule } from './cowork-handle'

export function registerCoworkFoldersHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, cowork } = ctx
  handle('tasks:folders:get', ({ folder }) => cowork.folderSet(folder))
  handle('tasks:folders:check', ({ path }) => cowork.checkFolder(path))
  // `restart !== false` reinicia SOLO si el servidor sandbox del espacio está vivo (`restarted`).
  handle('tasks:folders:link', ({ folder, path, mode, trust, restart }) => cowork.linkFolder(folder, path, mode, { trust, restart }))
  handle('tasks:folders:unlink', ({ folder, path, restart }) => cowork.unlinkFolder(folder, path, { restart }))
  handle('tasks:trusted:list', () => cowork.trustedList())
  handle('tasks:trusted:set', ({ path, mode }) => cowork.setTrusted(path, mode))
  handle('tasks:trusted:remove', ({ path }) => cowork.removeTrusted(path))
  handle('tasks:policy', () => loadManagedPolicy())
  return {}
}
