import { Code2 } from 'lucide-react'
import { PlaceholderView } from '../../components/PlaceholderView'

export function CodeView(): React.JSX.Element {
  return (
    <PlaceholderView
      icon={Code2}
      title="Code"
      description="Agente de programación sobre una carpeta: sesiones por proyecto, permisos, diffs, terminal y plan/build."
      phase="Fase 2"
    />
  )
}
