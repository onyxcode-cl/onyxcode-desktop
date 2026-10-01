import { CalendarClock } from 'lucide-react'
import { MODE_LABELS } from '@shared/labels'
import type { ModeDefinition } from '../../app/types'
import { RoutinesView } from './impl/RoutinesView'

export const routinesMode: ModeDefinition = {
  id: 'routines',
  get label() {
    return MODE_LABELS.routines
  },
  icon: CalendarClock,
  View: RoutinesView
}
