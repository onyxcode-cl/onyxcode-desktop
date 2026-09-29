import { Users } from 'lucide-react'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { newTask } from './impl/actions'
import { CoworkSidebar } from './impl/TasksSidebar'
import { CoworkWorkspace } from './impl/TasksWorkspace'

export const coworkMode: ModeDefinition = {
  id: 'tasks',
  label: MODE_LABELS.tasks,
  icon: Users,
  View: CoworkWorkspace,
  SidebarContent: CoworkSidebar,
  newAction: { label: 'Nueva tarea', run: newTask }
}
