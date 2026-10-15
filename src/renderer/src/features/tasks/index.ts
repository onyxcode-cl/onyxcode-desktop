import { ListChecks } from 'lucide-react'
import { t } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { chooseFolder, newTask } from './impl/actions'
import { TasksSearchBox } from './impl/TasksSearchBox'
import { TasksSidebar } from './impl/TasksSidebar'
import { TasksWorkspace } from './impl/TasksWorkspace'

export const tasksMode: ModeDefinition = {
  id: 'tasks',
  get label() {
    return MODE_LABELS.tasks
  },
  icon: ListChecks,
  View: TasksWorkspace,
  SidebarContent: TasksSidebar,
  SidebarSearch: TasksSearchBox,
  projectAction: () => void chooseFolder(),
  newAction: {
    get label() {
      return t('app.mode.newTask')
    },
    run: newTask
  }
}

/** Inicio de Tareas del celular (aprobaciones + «En curso»). La PWA lo sustituye por un trozo perezoso (`remote/swaps.ts`). */
export { MobileTasksHome } from './impl/MobileTasksHome'
