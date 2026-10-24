/**
 * Banda de «Trabajos en segundo plano» sobre el compositor, unificada: una fila por subagente que sigue trabajando mientras la
 * conversación continúa (botón «Cancelar») y una por cada comando o ejecución de Code Mode del motor propio (botón «Parar»),
 * con su estado y el tiempo que llevan. Sin trabajos no pinta nada.
 *
 * Es solo presentación: quien la monta le da la vista ya calculada (`selectBackgroundJobs`, `selectEngineJobs`) y qué hacer
 * al cancelar o parar. Los ayudantes no tienen «Pedir resultado» (su resultado vuelve solo a la conversación), así que tampoco
 * se ofrece para los trabajos del motor.
 */
import { useEffect, useState } from 'react'
import { AlertCircle, Ban, Bot, Check, Loader2, ShieldQuestion, TimerOff, X } from 'lucide-react'
import type { EngineJobState } from '@shared/engine-jobs'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface } from '../../../lib/platform'
import { formatElapsed, MAX_VISIBLE_JOBS, type BackgroundJob, type BackgroundJobsView } from './background-jobs'
import type { EngineJobRow } from './engine-jobs'

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
  /** Comandos y ejecuciones de Code Mode del motor propio (ya filtrados y ordenados). Opcional: sin ellos solo hay ayudantes. */
  engineJobs?: readonly EngineJobRow[]
  /** Termina un trabajo del motor. Si rechaza, se avisa en la propia fila. */
  onStopEngineJob?: (jobId: string) => Promise<void> | void
}

const ENGINE_STATE_KEY = {
  en_curso: 'code.bg.engine.running',
  terminado: 'code.bg.engine.done',
  terminado_por_ti: 'code.bg.engine.stopped',
  tope_de_vida: 'code.bg.engine.expired',
  perdido: 'code.bg.engine.lost'
} as const satisfies Record<EngineJobState, string>

const KIND_KEY = { shell: 'code.bg.engine.kindShell', celda: 'code.bg.engine.kindCell' } as const

function EngineStateIcon({ state }: { state: EngineJobState }): React.JSX.Element {
  switch (state) {
    case 'en_curso':
      return <Loader2 size={13} className="animate-spin text-accent motion-reduce:animate-none" aria-hidden />
    case 'terminado':
      return <Check size={13} className="text-accent" aria-hidden />
    case 'terminado_por_ti':
      return <Ban size={13} className="text-muted" aria-hidden />
    case 'tope_de_vida':
      return <TimerOff size={13} className="text-warning" aria-hidden />
    default:
      return <AlertCircle size={13} className="text-warning" aria-hidden />
  }
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

export function BackgroundJobs({ view, onCancel, engineJobs = [], onStopEngineJob }: Props): React.JSX.Element | null {
  const t = useT()
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({})
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [stopping, setStopping] = useState<Record<string, boolean>>({})
  const [stopFailed, setStopFailed] = useState<Record<string, boolean>>({})
  if (view.jobs.length === 0 && engineJobs.length === 0) return null
  const liveCount = view.liveCount + engineJobs.filter((j) => j.live).length

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

  const stop = async (id: string): Promise<void> => {
    setStopping((c) => ({ ...c, [id]: true }))
    setStopFailed((f) => ({ ...f, [id]: false }))
    try {
      await onStopEngineJob?.(id)
    } catch {
      setStopFailed((f) => ({ ...f, [id]: true }))
    } finally {
      setStopping((c) => ({ ...c, [id]: false }))
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
          <span className="text-subtle">{t('code.bg.count', { count: liveCount })}</span>
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
          {engineJobs.map((job) => (
            <li key={`engine:${job.id}`} className={`flex items-center gap-2 ${touch ? 'min-h-11 flex-wrap' : ''}`}>
              <EngineStateIcon state={job.state} />
              <span className={`min-w-0 flex-1 truncate ${job.live ? 'text-fg' : 'text-muted'}`} title={job.title}>
                {job.title}
                <span className="text-subtle"> · {t(KIND_KEY[job.kind])}</span>
              </span>
              <span className="shrink-0 text-xs text-muted">
                {t(ENGINE_STATE_KEY[job.state])}
                {job.state === 'terminado' &&
                  job.code !== null &&
                  job.code !== 0 &&
                  ` · ${t('code.bg.engine.exitCode', { code: job.code })}`}
              </span>
              <span className="shrink-0 text-xs tabular-nums text-subtle">{formatElapsed(job.elapsedMs)}</span>
              {stopFailed[job.id] && (
                <span role="alert" className="shrink-0 text-xs text-danger">
                  {t('code.bg.engine.stopFailed')}
                </span>
              )}
              {job.live && onStopEngineJob && (
                <button
                  type="button"
                  disabled={stopping[job.id]}
                  aria-label={t('code.bg.engine.stopFor', { title: job.title })}
                  onClick={() => void stop(job.id)}
                  className={`flex shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${touch ? 'h-11' : 'h-6'}`}
                >
                  <X size={12} aria-hidden />
                  {t('code.bg.engine.stop')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
