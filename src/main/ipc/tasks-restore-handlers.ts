/**
 * Handlers de puntos de restauración (`tasks:restore:*`). Solo ventana principal.
 * La carpeta se valida con `TasksManager.assertInsideApproved`; `apply` rechaza con BUSY si el
 * monitor ve trabajo en curso en esa carpeta (restaurar con el agente escribiendo daría un
 * resultado mezclado).
 */
import { t } from '@shared/i18n'
import { app, shell } from 'electron'
import { join } from 'node:path'
import { RestorePoints } from '../tasks/restore-points'
import { resolveE2eTrashDir, trashToDir } from '../tasks/trash'
import { IpcError } from './handle'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

/** Crea el almacén (userData/restore-points) con la Papelera real (o la de pruebas). */
export function createRestorePoints(): RestorePoints {
  const testTrash = resolveE2eTrashDir({ isPackaged: app.isPackaged, env: process.env })
  return new RestorePoints({
    root: join(app.getPath('userData'), 'restore-points'),
    trash: testTrash ? trashToDir(testTrash) : (p) => shell.trashItem(p)
  })
}

export function registerTasksRestoreHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle, tasks, restore } = ctx
  // Retención y huérfanos al arrancar (fuera del camino crítico).
  const timer = setTimeout(() => {
    try {
      restore.gc()
    } catch (err) {
      console.error('[restore] gc:', err)
    }
  }, 15_000)
  timer.unref?.()

  handle('tasks:restore:create', ({ folder, sessionId, label }) => {
    const real = tasks.assertInsideApproved(folder)
    // Control total sin carpeta (carpeta personal): una instantánea de todo el home no es viable; se omite sin recorrerlo.
    if (tasks.coversHome(real)) {
      return {
        id: '',
        sessionId,
        folder: real,
        createdAt: Date.now(),
        label: label.slice(0, 200),
        files: 0,
        bytes: 0,
        status: 'skipped' as const,
        reason: t('merr.restore.homeSkipped')
      }
    }
    return restore.create(real, sessionId, label)
  })
  handle('tasks:restore:list', ({ folder, sessionId }) => restore.list(tasks.assertInsideApproved(folder), sessionId))
  handle('tasks:restore:changes', ({ folder, pointId }) => restore.changes(tasks.assertInsideApproved(folder), pointId))
  handle('tasks:restore:apply', ({ folder, pointId, paths }) => {
    const root = tasks.assertInsideApproved(folder)
    if (ctx.isFolderBusy(root))
      throw new IpcError('BUSY', 'La tarea sigue trabajando. Espera a que termine o detenla antes de deshacer los cambios.')
    return restore.apply(root, pointId, paths)
  })
  handle('tasks:restore:forget', async ({ sessionId }) => {
    await restore.forget(sessionId)
  })
  return { dispose: () => clearTimeout(timer) }
}
