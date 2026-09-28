import { CalendarClock } from 'lucide-react'
import { PlaceholderView } from '../../components/PlaceholderView'

export function RoutinesView(): React.JSX.Element {
  return (
    <PlaceholderView
      icon={CalendarClock}
      title="Rutinas"
      description="Tareas programadas que lanzan prompts automáticamente y avisan con notificaciones."
      phase="Fase 3"
    />
  )
}
