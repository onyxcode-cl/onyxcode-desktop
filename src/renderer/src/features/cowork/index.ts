import { Users } from 'lucide-react'
import type { ModeDefinition } from '../../app/types'
import { CoworkView } from './CoworkView'

export const coworkMode: ModeDefinition = {
  id: 'cowork',
  label: 'Cowork',
  icon: Users,
  View: CoworkView
}
