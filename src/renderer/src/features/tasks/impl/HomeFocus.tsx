/** Bloques del inicio de Tareas para retomar trabajo: «Esperando tu aprobación» y «Retomar». Sin datos no pintan nada. */
import { useT } from '../../../lib/i18n'
import { StateDot, type SessionState } from '../../../components/SidebarTree'
import { openTask } from './actions'
import type { HomeFocus, HomeFocusItem } from './home-focus'
import { relTime, TASK_STATUS_LABEL, type TaskStatus } from './util'

function dotState(status: TaskStatus): SessionState | null {
  if (status === 'waiting' || status === 'question' || status === 'plan_ready') return 'waiting'
  if (status === 'running' || status === 'using_computer') return 'working'
  if (status === 'done') return 'done'
  return null
}

/** Segunda línea de una fila: qué pasa con la tarea (y cuándo, si ya no está en marcha). */
function statusLine(i: HomeFocusItem): string {
  const label = TASK_STATUS_LABEL[i.status]
  const live = i.status === 'running' || i.status === 'using_computer' || dotState(i.status) === 'waiting'
  return live ? label : `${label} · ${relTime(i.task.time.updated)}`
}

function Dot({ status }: { status: TaskStatus }): React.JSX.Element {
  const state = dotState(status)
  return state ? <StateDot state={state} /> : <span aria-hidden="true" className="size-[7px] shrink-0" />
}

/** Tarjeta de arriba: tareas paradas esperando tu aprobación o respuesta. */
export function WaitingCard({ focus }: { focus: HomeFocus }): React.JSX.Element | null {
  const t = useT()
  if (focus.waiting.length === 0) return null
  const more = focus.waitingTotal - focus.waiting.length
  return (
    <section
      aria-labelledby="home-waiting-title"
      className="mx-6 mb-5 rounded-xl border border-warning/40 bg-elevated p-2 shadow-sm desk:rounded-card"
    >
      <h2 id="home-waiting-title" className="px-2 pt-1 pb-1.5 text-sm font-medium text-fg">
        {t('tasks.home.waiting.title')}
      </h2>
      <ul className="m-0 list-none p-0">
        {focus.waiting.map((i) => {
          const title = i.task.title || t('tasks.list.untitled')
          return (
            <li key={i.task.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-hover desk:rounded-ctl">
              <Dot status={i.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{title}</span>
                <span className="block truncate text-xs text-warning">{statusLine(i)}</span>
              </span>
              <button
                type="button"
                aria-label={t('tasks.home.waiting.openAria', { title })}
                onClick={() => void openTask(i.task.id)}
                className="shrink-0 rounded-lg border border-border bg-elevated px-3 py-1 text-xs font-medium text-fg transition hover:border-border-strong hover:bg-hover desk:rounded-ctl"
              >
                {t('tasks.home.waiting.open')}
              </button>
            </li>
          )
        })}
      </ul>
      {more > 0 && <p className="px-2 pt-1 pb-1 text-xs text-muted">{t('tasks.home.waiting.more', { n: more })}</p>}
    </section>
  )
}

/** Bloque «Retomar»: las tareas más recientes de la carpeta. */
export function ResumeBlock({ focus }: { focus: HomeFocus }): React.JSX.Element | null {
  const t = useT()
  if (focus.recent.length === 0) return null
  return (
    <section aria-labelledby="home-resume-title" className="mt-8 px-6">
      <h2 id="home-resume-title" className="mb-2 text-xs font-medium text-muted">
        {t('tasks.home.resume.title')}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {focus.recent.map((i) => (
          <li key={i.task.id}>
            <button
              type="button"
              onClick={() => void openTask(i.task.id)}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-hover desk:rounded-card"
            >
              <Dot status={i.status} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-fg">{i.task.title || t('tasks.list.untitled')}</span>
                <span className="block truncate text-xs text-muted">{statusLine(i)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
