import { CalendarClock } from 'lucide-react'
import type { ModeDefinition } from '../../app/types'
import { RoutinesView } from './RoutinesView'

export const routinesMode: ModeDefinition = {
  id: 'routines',
  label: 'Rutinas',
  icon: CalendarClock,
  View: RoutinesView
}
