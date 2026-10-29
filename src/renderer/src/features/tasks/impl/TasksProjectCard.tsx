/** Ficha del proyecto de la tarea activa (Overdrive): carpeta de la tarea, carpetas vinculadas, nivel de acceso y Bóveda. «Control total» usa el modo que ya existe. */
import { t } from '@shared/i18n'
import { ProjectCard } from '../../project-profile/ProjectCard'
import { ProjectSeal } from '../../project-profile/ProjectSeal'
import type { ProjectFolders } from '../../project-profile/ProjectDialog'
import { applyAccessChange, linkFolder, unlinkFolder } from './actions'
import { cw } from './bridge'
import { isChatFolderForDisplay, useUnifiedApps } from './unified'
import { useScope } from './ScopePicker'
import { useTasks } from './store'

/** Las carpetas vinculadas del espacio, con las mismas acciones (validar, confirmar si hay tareas en curso, reiniciar) que el menú de carpetas. */
export function useProjectFolders(folder: string): ProjectFolders {
  const folderSet = useTasks((s) => s.folderSet)
  return {
    linked: (folderSet?.linked ?? []).map((l) => ({ path: l.path, name: l.name, mode: l.mode })),
    applied: folderSet?.applied ?? true,
    pick: async () => {
      const picked = await cw('tasks:pickFolder')
      if (!picked) return null
      const chk = await cw('tasks:folders:check', { path: picked })
      if (!chk.ok) return { error: chk.reason ?? t('tasksComputer.folder.cannotAdd') }
      if (chk.normalized === folder) return { error: t('tasksComputer.menu.isPrimary') }
      if (folderSet?.linked.some((l) => l.path === chk.normalized)) return { error: t('tasksComputer.menu.alreadyAdded') }
      return { path: chk.normalized }
    },
    link: async (path, mode) =>
      (await linkFolder(path, mode)) ? true : { error: useTasks.getState().error ?? t('tasksComputer.folder.cannotAdd') },
    unlink: (path) => unlinkFolder(path)
  }
}

export function TasksProjectCard({ busy }: { busy: boolean }): React.JSX.Element | null {
  const folder = useTasks((s) => s.folder)
  const unified = useUnifiedApps()
  const scope = useScope(busy)
  const folders = useProjectFolders(folder ?? '')
  // Sin carpeta (o con la carpeta propia automática del chat) no hay proyecto al que ponerle una ficha.
  if (!folder || (unified && isChatFolderForDisplay(folder))) return null
  return (
    <ProjectCard
      folder={folder}
      full={scope.full}
      onPickFull={scope.canFull ? scope.pick : undefined}
      busy={busy}
      folders={folders}
      onAccessSaved={() => void applyAccessChange(folder)}
    />
  )
}

/** El mismo nivel como sello junto a los demás chips de la caja de escribir. */
export function TasksProjectSeal({ busy }: { busy: boolean }): React.JSX.Element | null {
  const folder = useTasks((s) => s.folder)
  const unified = useUnifiedApps()
  const scope = useScope(busy)
  const folders = useProjectFolders(folder ?? '')
  if (!folder || (unified && isChatFolderForDisplay(folder))) return null
  return (
    <ProjectSeal
      folder={folder}
      full={scope.full}
      onPickFull={scope.canFull ? scope.pick : undefined}
      busy={busy}
      folders={folders}
      onAccessSaved={() => void applyAccessChange(folder)}
    />
  )
}
