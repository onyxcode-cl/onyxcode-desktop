/** Panel «Entorno» de la cabecera de una tarea: equipo, carpeta, modo de acceso (con «Cambiar») y punto de restauración. */
import { EnvironmentPanel } from '../../../components/EnvironmentPanel'
import { useT } from '../../../lib/i18n'
import { useHostName } from '../../../lib/use-host-name'
import { useScope } from './ScopePicker'
import { useTasks } from './store'

const norm = (p: string): string => p.replace(/[\\/]+$/, '').replace(/\\/g, '/')

export function TasksEnvironment({ disabled }: { disabled?: boolean }): React.JSX.Element | null {
  const t = useT()
  const hostName = useHostName()
  const conn = useTasks((s) => s.conn)
  const phase = useTasks((s) => s.phase)
  const requested = useTasks((s) => s.fullAccess)
  const folder = useTasks((s) => s.folder)
  const folders = useTasks((s) => s.folders)
  const info = useTasks((s) => s.fullAccessInfo)
  // Sin Control del PC solo existe el modo aislado: no hay nada que cambiar (igual que el selector del inicio).
  const scope = useScope(disabled)
  if (!scope.canFull) return null
  const full = conn ? conn.fullAccess : requested
  const directory = folder ?? (full ? (info?.workspace ?? null) : null)
  const authorized = !!folder && folders.some((f) => f.path === folder)
  const isHome = !!directory && !!info?.home && norm(directory) === norm(info.home)
  return (
    <EnvironmentPanel
      hostName={hostName}
      directory={directory}
      mode={{
        full,
        label: full ? t('tasksComputer.chip.full') : t('tasksComputer.chip.folder'),
        otherLabel: full ? t('tasksComputer.chip.folder') : t('tasksComputer.chip.full'),
        busy: disabled || phase === 'starting',
        blockedReason: full && !authorized ? t('env.mode.needFolder') : null,
        onChange: () => scope.pick(!full),
        ...(directory ? { restore: full && isHome ? ('off' as const) : ('on' as const) } : {})
      }}
    />
  )
}
