import { ChevronRight, Hand } from 'lucide-react'
import { useT } from '../../lib/i18n'
import { rootTaskId, useTasks } from '../../features/tasks/impl/store'
import { useSessions } from '../../stores/sessions'
import { useMobileNavStore } from './nav'
import { useUi } from '../../stores/ui'

/**
 * Aviso de Inicio (celular): hay tareas esperando aprobación. Lleva a la pestaña Tareas, donde está la tarjeta de permiso
 * (aquí NO se responde nada). El dato es el mismo que el punto de la barra: `useTasks.permissions`, que solo se llena cuando
 * el store de Tareas ya está conectado a una carpeta (no se carga al arrancar; decisión 3 del dueño).
 */
export function ApprovalNotice(): React.JSX.Element | null {
  const t = useT()
  const permissions = useTasks((s) => s.permissions)
  const sessions = useSessions((s) => s.sessions)
  const reqs = Object.values(permissions)
  if (reqs.length === 0) return null
  // Raíces distintas (una subtarea pide permiso en nombre de su tarea raíz); el título es el de la primera.
  const roots = Array.from(new Set(reqs.map((p) => rootTaskId(p.sessionID))))
  const title = sessions[roots[0]]?.title
  return (
    <button
      type="button"
      data-m="approval-notice"
      onClick={() => {
        useMobileNavStore.getState().setTab('tasks')
        useUi.getState().setMode('tasks')
      }}
      className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-warning/45 bg-warning/10 px-3.5 py-2 text-left active:bg-warning/15"
    >
      <Hand size={22} className="shrink-0 text-warning" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] leading-5 font-semibold text-fg">{t('mobile.home.approvals', { count: roots.length })}</span>
        {title && <span className="block truncate text-[13px] leading-4 text-muted">{title}</span>}
        <span className="sr-only">{t('mobile.home.approvalsOpen')}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden="true" />
    </button>
  )
}
