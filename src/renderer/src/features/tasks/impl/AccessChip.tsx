/**
 * Chip del modo de acceso de Overdrive en la fila inferior de la caja de escribir: «Solo en tu carpeta» / «Control total del Mac»,
 * siempre a la vista, con una frase por opción. Usa la misma acción (`setAccessMode`) y los mismos textos que el selector de la
 * barra superior y el de la pantalla de inicio (que se mantienen): no cambia reglas de seguridad ni el valor por defecto.
 */
import { MonitorCog, Shield } from 'lucide-react'
import { TASKS_TERMS } from '@shared/tasks-glossary'
import { ChipMenu } from '../../../components/ChipMenu'
import { useT } from '../../../lib/i18n'
import { platformCaps } from '../../../lib/platform'
import { setAccessMode } from './actions'
import { useTasks } from './store'

export function AccessChip({ disabled }: { disabled?: boolean }): React.JSX.Element {
  const t = useT()
  const conn = useTasks((s) => s.conn)
  const phase = useTasks((s) => s.phase)
  const requested = useTasks((s) => s.fullAccess)
  const full = conn ? conn.fullAccess : requested
  const canFull = platformCaps().computer
  return (
    <ChipMenu
      name={t('tasksComputer.access.aria')}
      valueLabel={full ? TASKS_TERMS.fullControl : TASKS_TERMS.sandbox}
      icon={full ? <MonitorCog size={14} aria-hidden /> : <Shield size={14} aria-hidden />}
      value={full ? 'full' : 'sandbox'}
      tone={full ? 'warning' : undefined}
      disabled={disabled || phase === 'starting'}
      collapseClass="inline desk:@max-[34rem]:sr-only"
      shortClass="hidden desk:@max-[34rem]:inline"
      testId="access-chip"
      options={[
        {
          id: 'sandbox',
          label: TASKS_TERMS.sandbox,
          shortLabel: t('tasksComputer.access.sandboxShort'),
          hint: t('tasksComputer.access.sandboxDesc'),
          icon: <Shield size={14} className="text-accent" aria-hidden />
        },
        ...(canFull
          ? [
              {
                id: 'full',
                label: TASKS_TERMS.fullControl,
                shortLabel: t('tasksComputer.access.fullShort'),
                hint: t('tasksComputer.access.fullDesc'),
                icon: <MonitorCog size={14} className="text-warning" aria-hidden />,
                tone: 'warning' as const
              }
            ]
          : [])
      ]}
      onSelect={(id) => void setAccessMode(id === 'full')}
    />
  )
}
