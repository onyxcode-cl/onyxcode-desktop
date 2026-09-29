import { Users } from 'lucide-react'
import type { ModeDefinition } from '../../app/types'
import { newTask } from './impl/actions'
import { CoworkSidebar } from './impl/CoworkSidebar'
import { CoworkWorkspace } from './impl/CoworkWorkspace'

export const coworkMode: ModeDefinition = {
  id: 'cowork',
  label: 'Cowork',
  icon: Users,
  View: CoworkWorkspace,
  SidebarContent: CoworkSidebar,
  newAction: { label: 'Nueva tarea', run: newTask }
}
