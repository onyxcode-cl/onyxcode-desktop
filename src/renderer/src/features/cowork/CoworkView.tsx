import { Users } from 'lucide-react'
import { PlaceholderView } from '../../components/PlaceholderView'

export function CoworkView(): React.JSX.Element {
  return (
    <PlaceholderView
      icon={Users}
      title="Cowork"
      description="Tareas autónomas sobre una carpeta de documentos, ejecutadas en un sandbox."
      phase="Fase 3"
    />
  )
}
