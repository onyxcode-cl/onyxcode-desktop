import { Users } from 'lucide-react'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { newTask } from './impl/actions'
import { CoworkSidebar } from './impl/CoworkSidebar'
import { CoworkWorkspace } from './impl/CoworkWorkspace'

export const coworkMode: ModeDefinition = {
  id: 'cowork',
  label: MODE_LABELS.cowork,
  icon: Users,
  View: CoworkWorkspace,
  SidebarContent: CoworkSidebar,
  newAction: { label: 'Nueva tarea', run: newTask }
}
