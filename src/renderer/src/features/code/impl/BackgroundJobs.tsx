/**
 * Banda de «Trabajos en segundo plano» sobre el compositor: una fila por subagente que sigue trabajando mientras la
 * conversación continúa, con su estado, el tiempo que lleva y un botón «Cancelar». Sin trabajos no pinta nada.
 *
 * Es solo presentación: quien la monta le da la vista ya calculada (`selectBackgroundJobs`) y qué hacer al cancelar.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Bot, Check, Loader2, ShieldQuestion, X } from 'lucide-react'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface } from '../../../lib/platform'
import { formatElapsed, MAX_VISIBLE_JOBS, type BackgroundJob, type BackgroundJobsView } from './background-jobs'

/** Reloj que avanza cada segundo solo mientras `active` (sin trabajos vivos no hay temporizador). */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

interface Props {
  view: BackgroundJobsView
  /** Aborta la sesión hija. Si rechaza, se avisa en la propia fila. */
  onCancel: (sessionId: string) => Promise<void> | void
}

const STATE_KEY = {
  running: 'code.bg.running',
  waiting: 'code.bg.waiting',
  done: 'code.bg.done',
  failed: 'code.bg.failed'
} as const

function StateIcon({ state }: { state: BackgroundJob['state'] }): React.JSX.Element {
  switch (state) {
    case 'running':
      return <Loader2 size={13} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden />
    case 'waiting':
      return <ShieldQuestion size={13} className="text-warning" aria-hidden />
    case 'done':
      return <Check size={13} className="text-accent" aria-hidden />
    default:
      return <AlertCircle size={13} className="text-danger" aria-hidden />
  }
}

export function BackgroundJobs({ view, onCancel }: Props): React.JSX.Element | null {
  const t = useT()
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({})
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  if (view.jobs.length === 0) return null

  const touch = isRemoteSurface()
  const cancel = async (id: string): Promise<void> => {
    setCancelling((c) => ({ ...c, [id]: true }))
    setFailed((f) => ({ ...f, [id]: false }))
    try {
      await onCancel(id)
    } catch {
      setFailed((f) => ({ ...f, [id]: true }))
      setCancelling((c) => ({ ...c, [id]: false }))
    }
  }

  return (
    <section
      aria-label={t('code.bg.title')}
      className={`mx-auto mb-2 w-full max-w-3xl desk:max-w-[var(--measure-prose)] ${touch ? 'px-3' : 'px-6'}`}
    >
      <div className="rounded-xl border border-border bg-elevated/60 px-3 py-2 text-[13px]">
        <div className="mb-1 flex items-center gap-2 text-xs font-medium text-muted">
          <Bot size={13} aria-hidden />
          <h3 className="font-medium">{t('code.bg.title')}</h3>
          <span className="text-subtle">{t('code.bg.count', { count: view.liveCount })}</span>
        </div>
        {view.overLimit && (
          <p role="status" className="mb-1 text-xs text-warning">
            {t('code.bg.over', { count: view.liveCount, shown: MAX_VISIBLE_JOBS })}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {view.jobs.map((job) => {
            const live = job.state === 'running' || job.state === 'waiting'
            return (
              <li key={job.id} className={`flex items-center gap-2 ${touch ? 'min-h-11 flex-wrap' : ''}`}>
                <StateIcon state={job.state} />
                <span className={`min-w-0 flex-1 truncate ${live ? 'text-fg' : 'text-muted'}`} title={job.title}>
                  {job.title}
                  {job.agent && <span className="text-subtle"> · {t('code.bg.agent', { agent: job.agent })}</span>}
                </span>
                <span className="shrink-0 text-xs text-muted">{t(STATE_KEY[job.state])}</span>
                <span className="shrink-0 text-xs tabular-nums text-subtle">{formatElapsed(job.elapsedMs)}</span>
                {failed[job.id] && (
                  <span role="alert" className="shrink-0 text-xs text-danger">
                    {t('code.bg.cancelFailed')}
                  </span>
                )}
                {live && (
                  <button
                    type="button"
                    disabled={cancelling[job.id]}
                    aria-label={t('code.bg.cancelFor', { title: job.title })}
                    onClick={() => void cancel(job.id)}
                    className={`flex shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${touch ? 'h-11' : 'h-6'}`}
                  >
                    <X size={12} aria-hidden />
                    {t('code.bg.cancel')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
