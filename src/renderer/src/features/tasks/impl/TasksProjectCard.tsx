/** Ficha del proyecto de la tarea activa (Overdrive): carpeta de la tarea, nivel de acceso y Bóveda. «Control total» usa el modo que ya existe. */
import { ProjectCard } from '../../project-profile/ProjectCard'
import { ProjectSeal } from '../../project-profile/ProjectSeal'
import { isChatFolderForDisplay, useUnifiedApps } from './unified'
import { useScope } from './ScopePicker'
import { useTasks } from './store'

export function TasksProjectCard({ busy }: { busy: boolean }): React.JSX.Element | null {
  const folder = useTasks((s) => s.folder)
  const unified = useUnifiedApps()
  const scope = useScope(busy)
  // Sin carpeta (o con la carpeta propia automática del chat) no hay proyecto al que ponerle una ficha.
  if (!folder || (unified && isChatFolderForDisplay(folder))) return null
  return <ProjectCard folder={folder} full={scope.full} onPickFull={scope.canFull ? scope.pick : undefined} busy={busy} />
}

/** El mismo nivel como sello junto a los demás chips de la caja de escribir. */
export function TasksProjectSeal({ busy }: { busy: boolean }): React.JSX.Element | null {
  const folder = useTasks((s) => s.folder)
  const unified = useUnifiedApps()
  const scope = useScope(busy)
  if (!folder || (unified && isChatFolderForDisplay(folder))) return null
  return <ProjectSeal folder={folder} full={scope.full} onPickFull={scope.canFull ? scope.pick : undefined} busy={busy} />
}
