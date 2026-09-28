/** Ajustes › Control del Mac: permisos por app (concesión por app de "computer use"). */
import { MonitorCog } from 'lucide-react'
import { ComputerGrantsList } from '../../cowork/impl/ComputerAccess'

export function ComputerSection(): React.JSX.Element {
  return (
    <div>
      <h2 className="mb-1 flex items-center gap-2 text-base font-semibold text-fg">
        <MonitorCog size={17} className="text-accent" /> Control del Mac
      </h2>
      <p className="mb-5 text-sm text-muted">
        Cuando una tarea de Cowork tiene "Acceso total", el agente solo puede actuar sobre las apps que le hayas
        concedido, con el nivel que elijas. Las nuevas apps se piden con una tarjeta cuando el agente las necesita.
      </p>
      <ComputerGrantsList />
    </div>
  )
}
