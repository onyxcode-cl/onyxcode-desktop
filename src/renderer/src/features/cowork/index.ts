import { Users } from 'lucide-react'
import type { ModeDefinition } from '../../app/types'
import { CoworkWorkspace } from './impl/CoworkWorkspace'

export const coworkMode: ModeDefinition = {
  id: 'cowork',
  label: 'Cowork',
  icon: Users,
  View: CoworkWorkspace
}
