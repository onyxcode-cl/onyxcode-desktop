/**
 * Handlers de la memoria y las instrucciones de Chat y Code (`tasks:mem:*`, `tasks:instr:*`).
 *
 * - Memoria: mismo almacén que Tareas (`userData/memoria/`), pero la carpeta de un proyecto de Code se valida como
 *   carpeta real existente (`projectRoot`), no como carpeta aprobada de Tareas: aquí la ruta solo es la llave de un
 *   archivo dentro de `userData`; no se lee ni se escribe nada dentro de la carpeta.
 * - Instrucciones del proyecto: solo `<carpeta>/AGENTS.md` (reusa `getAgentsMd`/`saveAgentsMd`: enlaces simbólicos
 *   que salen de la carpeta, archivo que no es archivo y tamaño). Se niega en el home, en la raíz y en `userData`.
 * - Todos son clase X en `remote/policy.ts`: nunca desde el celular.
 */
import { homedir } from 'node:os'
import { realpathSync } from 'node:fs'
import { parse } from 'node:path'
import { app } from 'electron'
import { t } from '@shared/i18n'
import {
  acceptLearnedMemory,
  clearLearnedMemory,
  forgetAllLearnedMemory,
  getLearnedMemory,
  removeLearnedMemoryEntry,
  updateLearnedMemoryEntry
} from '../tasks/learned-memory'
import { getAgentsMd, saveAgentsMd } from '../tasks/projects'
import { projectRoot } from '../files/fs-ops'
import { isInside } from '../util/paths'
import type { TasksIpcContext, TasksSubmodule } from './tasks-handle'

function real(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

/** Carpeta de proyecto válida para guardar instrucciones: existente, y ni la raíz, ni el home, ni dentro de la carpeta de datos de la app. */
export function assertInstructionsFolder(folder: string, home: string = homedir(), userData: string = app.getPath('userData')): string {
  const root = projectRoot(folder)
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
  if (same(root, parse(root).root) || same(root, real(home)) || same(root, home) || isInside(root, real(userData))) {
    throw new Error(t('merr.task.pathNotAuthorized'))
  }
  return root
}

export function registerTasksMemoryHandlers(ctx: TasksIpcContext): TasksSubmodule {
  const { handle } = ctx
  const folderOrNull = (folder: string | undefined): string | null => (folder ? projectRoot(folder) : null)

  handle('tasks:mem:get', ({ folder }) => getLearnedMemory(folderOrNull(folder)))
  handle('tasks:mem:accept', ({ folder, proposals }) => acceptLearnedMemory(folderOrNull(folder), proposals).bundle)
  handle('tasks:mem:update', ({ alcance, folder, id, tipo, texto }) =>
    updateLearnedMemoryEntry(alcance, folderOrNull(folder), id, { tipo, texto })
  )
  handle('tasks:mem:remove', ({ alcance, folder, id }) => removeLearnedMemoryEntry(alcance, folderOrNull(folder), id))
  handle('tasks:mem:clear', ({ alcance, folder }) => clearLearnedMemory(alcance, folderOrNull(folder)))
  handle('tasks:mem:forgetAll', () => {
    forgetAllLearnedMemory()
  })

  handle('tasks:instr:get', ({ folder }) => getAgentsMd(assertInstructionsFolder(folder)))
  handle('tasks:instr:save', ({ folder, content }) => saveAgentsMd(assertInstructionsFolder(folder), content))

  return {}
}
