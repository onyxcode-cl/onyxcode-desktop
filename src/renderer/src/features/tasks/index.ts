import { Users } from 'lucide-react'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { newTask } from './impl/actions'
import { TasksSidebar } from './impl/TasksSidebar'
import { TasksWorkspace } from './impl/TasksWorkspace'

export const tasksMode: ModeDefinition = {
  id: 'tasks',
  label: MODE_LABELS.tasks,
  icon: Users,
  View: TasksWorkspace,
  SidebarContent: TasksSidebar,
  newAction: { label: 'Nueva tarea', run: newTask }
}
