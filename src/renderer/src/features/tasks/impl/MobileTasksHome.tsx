/**
 * Inicio de Tareas en la PWA (rediseño, tanda T3): arriba las aprobaciones pendientes y debajo «En curso».
 *
 * - Las aprobaciones son `PermissionCard`: EL MISMO componente de la conversación (mismos botones, misma política del Mac,
 *   mismas respuestas); aquí no existe ningún camino de respuesta nuevo. Encima de cada tarjeta va el título de la tarea,
 *   porque se aprueba sin ver la conversación. Las que el Modo auto aún está considerando (`autoPending`) no se muestran,
 *   igual que en la conversación.
 * - «En curso» sale del store de Tareas y de `useSessions`: tocar una tarea hace `openTask` + apilar el detalle.
 * - Los datos reflejan el store ya conectado a una carpeta (no se carga nada nuevo al arrancar; decisiones-pwa #3).
 *
 * Solo se monta en el celular y va en un trozo perezoso (`remote/lazy/MobileTasksHome.tsx`): arrastra la tarjeta de permiso.
 */
import { useMemo } from 'react'
import type { PermissionRequest, Session } from '@opencode-ai/sdk/v2/client'
import { ChevronRight, ClipboardCheck, Hand, HelpCircle, RotateCcw } from 'lucide-react'
import { t } from '@shared/i18n'
import { DETAIL_SCREEN, useMobileNav } from '../../../app/mobile/nav'
import { useT } from '../../../lib/i18n'
import { selectSessionsForDirectory } from '../../../lib/session-reducer'
import { useSessions } from '../../../stores/sessions'
import { openTask } from './actions'
import { describePermission, PermissionCard, useMcpServers } from './PermissionPrompt'
import { splitInProgress } from './SidebarSections'
import { isPlanPending, isUsingComputer, useTasks } from './store'
import {
  evictedStatusOf,
  isArchivedSession,
  permissionBelongsTo,
  relTime,
  sessionBelongsTo,
  taskStatus,
  TASK_STATUS_LABEL,
  type TaskStatus
} from './util'

/** Título de la tarea (la raíz) a la que pertenece un permiso, que puede venir de una subtarea. */
function taskTitleOf(p: PermissionRequest, sessions: Record<string, Session>): string {
  let s: Session | undefined = sessions[p.sessionID]
  for (let i = 0; s?.parentID && i < 5; i++) s = sessions[s.parentID] ?? s
  return s?.title?.trim() || t('tasks.list.untitled')
}

function StatusMark({ status }: { status: TaskStatus }): React.JSX.Element {
  const common = 'shrink-0'
  switch (status) {
    case 'running':
    case 'using_computer':
      return (
        <span
          aria-hidden="true"
          className={`${common} size-[18px] animate-spin rounded-full border-2 border-accent border-r-transparent motion-reduce:animate-none`}
        />
      )
    case 'waiting':
      return <Hand size={18} aria-hidden="true" className={`${common} text-warning`} />
    case 'question':
      return <HelpCircle size={18} aria-hidden="true" className={`${common} text-accent`} />
    case 'plan_ready':
      return <ClipboardCheck size={18} aria-hidden="true" className={`${common} text-warning`} />
    default:
      return <RotateCcw size={18} aria-hidden="true" className={`${common} text-warning`} />
  }
}

function Overline({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="px-1 pb-2 text-[12px] leading-4 font-semibold text-subtle">{children}</h2>
}

export function MobileTasksHome(): React.JSX.Element {
  useT()
  const { push } = useMobileNav()
  const folder = useTasks((s) => s.folder)
  const permissions = useTasks((s) => s.permissions)
  const autoPending = useTasks((s) => s.autoPending)
  const questions = useTasks((s) => s.questions)
  const interrupted = useTasks((s) => s.interrupted)
  // Solo para repintar el estado «usando el Mac» / «plan listo» (como `TaskList`).
  useTasks((s) => s.lastAction)
  const sessions = useSessions((s) => s.sessions)
  const sessionSource = useSessions((s) => s.sessionSource)
  const directorySource = useSessions((s) => s.directorySource)
  const status = useSessions((s) => s.status)
  const errors = useSessions((s) => s.errors)
  const messages = useSessions((s) => s.messages)
  const servers = useMcpServers()

  // Las destructivas primero (orden estable dentro de cada grupo).
  const pending = useMemo(() => {
    const list = Object.values(permissions).filter((p) => !autoPending[p.id])
    const rank = (p: PermissionRequest): number => (describePermission(p, servers).danger ? 0 : 1)
    return list
      .map((p, i) => ({ p, i }))
      .sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i)
      .map((x) => x.p)
  }, [permissions, autoPending, servers])

  const live = useMemo(() => {
    if (!folder) return []
    const tasks = selectSessionsForDirectory({ sessions, sessionSource, directorySource }, folder)
    const perms = Object.values(permissions)
    const qs = Object.values(questions)
    const statusOf = (s: Session): TaskStatus =>
      taskStatus({
        run: status[s.id],
        waiting: perms.some((p) => permissionBelongsTo(p, s.id, sessions)),
        hasQuestion: qs.some((x) => sessionBelongsTo(x.sessionID, s.id, sessions)),
        error: errors[s.id],
        entries: messages[s.id],
        evicted: evictedStatusOf(s.id),
        usingComputer: isUsingComputer(s.id),
        planPending: isPlanPending(s.id),
        interrupted: !!interrupted[s.id],
        archived: isArchivedSession(s)
      })
    return splitInProgress(tasks, statusOf).live.map((s) => ({ session: s, status: statusOf(s) }))
  }, [folder, sessions, sessionSource, directorySource, permissions, questions, status, errors, messages, interrupted])

  const open = (id: string): void => {
    void openTask(id)
    push(DETAIL_SCREEN)
  }

  if (pending.length === 0 && live.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-16 text-center" data-m="tasks-home-empty">
        <p className="text-[15px] leading-5 text-muted">{t('mobile.tasks.emptyInProgress')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 px-4 pt-3 pb-6" data-m="tasks-home">
      {pending.length > 0 && (
        <section aria-label={t('mobile.tasks.pending')}>
          <Overline>{t('mobile.tasks.pending')}</Overline>
          <div className="flex flex-col gap-3">
            {pending.map((p) => (
              <div key={p.id}>
                <p className="truncate px-1 pb-1.5 text-[13px] leading-4 font-medium text-muted">{taskTitleOf(p, sessions)}</p>
                <PermissionCard request={p} />
              </div>
            ))}
          </div>
        </section>
      )}
      {live.length > 0 && (
        <section aria-label={t('mobile.tasks.inProgress')}>
          <Overline>{t('mobile.tasks.inProgress')}</Overline>
          <ul className="flex flex-col gap-2">
            {live.map(({ session, status: st }) => {
              const waits = st === 'waiting' || st === 'question'
              const caption = waits
                ? t('tasks.list.metaApprove')
                : st === 'running' || st === 'using_computer'
                  ? t('app.sidebar.working')
                  : TASK_STATUS_LABEL[st]
              return (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => open(session.id)}
                    className="flex min-h-16 w-full items-center gap-3 rounded-xl bg-elevated px-4 py-2.5 text-left shadow-sm active:bg-hover"
                  >
                    <StatusMark status={st} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] leading-5 font-medium">{session.title || t('tasks.list.untitled')}</span>
                      <span className={`block truncate text-[13px] leading-4 ${waits ? 'text-warning' : 'text-muted'}`}>
                        {caption} · {relTime(session.time.updated)}
                      </span>
                    </span>
                    <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-subtle" />
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
