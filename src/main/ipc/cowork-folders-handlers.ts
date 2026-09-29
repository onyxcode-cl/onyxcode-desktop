/**
 * Handlers de carpetas adicionales, carpetas de confianza y política gestionada
 * (`cowork:folders:*`, `cowork:trusted:*`, `cowork:policy`). La lógica vive en `CoworkManager`
 * (carpetas) y `policy.ts` (política); aquí solo se conectan al IPC.
 */
import { loadManagedPolicy } from '../cowork/policy'
import type { CoworkIpcContext, CoworkSubmodule } from './cowork-handle'

export function registerCoworkFoldersHandlers(ctx: CoworkIpcContext): CoworkSubmodule {
  const { handle, cowork } = ctx
  handle('cowork:folders:get', ({ folder }) => cowork.folderSet(folder))
  handle('cowork:folders:check', ({ path }) => cowork.checkFolder(path))
  // `restart !== false` reinicia SOLO si el servidor sandbox del espacio está vivo (`restarted`).
  handle('cowork:folders:link', ({ folder, path, mode, trust, restart }) => cowork.linkFolder(folder, path, mode, { trust, restart }))
  handle('cowork:folders:unlink', ({ folder, path, restart }) => cowork.unlinkFolder(folder, path, { restart }))
  handle('cowork:trusted:list', () => cowork.trustedList())
  handle('cowork:trusted:set', ({ path, mode }) => cowork.setTrusted(path, mode))
  handle('cowork:trusted:remove', ({ path }) => cowork.removeTrusted(path))
  handle('cowork:policy', () => loadManagedPolicy())
  return {}
}
