import { Users } from 'lucide-react'
import { t } from '@shared/i18n'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { newTask } from './impl/actions'
import { TasksSidebar } from './impl/TasksSidebar'
import { TasksWorkspace } from './impl/TasksWorkspace'

export const tasksMode: ModeDefinition = {
  id: 'tasks',
  get label() {
    return MODE_LABELS.tasks
  },
  icon: Users,
  View: TasksWorkspace,
  SidebarContent: TasksSidebar,
  newAction: {
    get label() {
      return t('app.mode.newTask')
    },
    run: newTask
  }
}
