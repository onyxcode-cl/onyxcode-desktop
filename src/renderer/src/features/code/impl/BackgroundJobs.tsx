/**
 * Lista de «Trabajos en segundo plano», como tarjeta del resumen o banda sobre el compositor: una fila por subagente que sigue trabajando mientras la
 * conversación continúa (botón «Cancelar») y una por cada comando o ejecución de Code Mode del motor propio (botón «Parar»),
 * con su estado y el tiempo que llevan. Sin trabajos no pinta nada.
 *
 * Es solo presentación: quien la monta le da la vista ya calculada (`selectBackgroundJobs`, `selectEngineJobs`) y qué hacer
 * al cancelar o parar. Los ayudantes no tienen «Pedir resultado» (su resultado vuelve solo a la conversación), así que tampoco
 * se ofrece para los trabajos del motor.
 */
import { useEffect, useRef, useState } from 'react'
import { AlertCircle, Ban, Bot, Check, Loader2, Play, ShieldQuestion, TimerOff, X } from 'lucide-react'
import type { EngineJobResumeResult, EngineJobState } from '@shared/engine-jobs'
import { useT } from '../../../lib/i18n'
import { isRemoteSurface } from '../../../lib/platform'
import { formatElapsed, MAX_VISIBLE_JOBS, type BackgroundJob, type BackgroundJobsView } from './background-jobs'
import type { EngineJobRow } from './engine-jobs'
import type { HelperLine } from './HelpersBoard'

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
  /** La tarjeta del panel usa todo el ancho disponible y permite repartir las filas en varias líneas. */
  layout?: 'card' | 'composer'
  onLoadConversation?: (sessionId: string) => Promise<HelperLine[]>
  conversationVersion?: (sessionId: string) => string
  view: BackgroundJobsView
  /** Aborta la sesión hija. Si rechaza, se avisa en la propia fila. */
  onCancel: (sessionId: string) => Promise<void> | void
  /** Comandos y ejecuciones de Code Mode del motor propio (ya filtrados y ordenados). Opcional: sin ellos solo hay ayudantes. */
  engineJobs?: readonly EngineJobRow[]
  /** Termina un trabajo del motor. Si rechaza, se avisa en la propia fila. */
  onStopEngineJob?: (jobId: string) => Promise<void> | void
  /** Reanuda un ayudante perdido (el motor se reinició). Sin él no se ofrece «Reanudar». */
  onResumeEngineJob?: (jobId: string) => Promise<EngineJobResumeResult>
}

const ENGINE_STATE_KEY = {
  en_curso: 'code.bg.engine.running',
  terminado: 'code.bg.engine.done',
  terminado_por_ti: 'code.bg.engine.stopped',
  tope_de_vida: 'code.bg.engine.expired',
  perdido: 'code.bg.engine.lost'
} as const satisfies Record<EngineJobState, string>

const KIND_KEY = {
  shell: 'code.bg.engine.kindShell',
  celda: 'code.bg.engine.kindCell',
  ayudante: 'code.bg.engine.kindHelper'
} as const
const RESUME_FAIL_KEY = {
  no_existe: 'code.bg.engine.resume.gone',
  ya_en_curso: 'code.bg.engine.resume.running',
  tope: 'code.bg.engine.resume.limit'
} as const

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

export function BackgroundJobs({
  view,
  onCancel,
  engineJobs = [],
  onStopEngineJob,
  onResumeEngineJob,
  layout = 'composer',
  onLoadConversation,
  conversationVersion
}: Props): React.JSX.Element | null {
  const t = useT()
  const [viewing, setViewing] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<Record<string, boolean>>({})
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [stopping, setStopping] = useState<Record<string, boolean>>({})
  const [stopFailed, setStopFailed] = useState<Record<string, boolean>>({})
  const [resuming, setResuming] = useState<Record<string, boolean>>({})
  const [resumeMsg, setResumeMsg] = useState<Record<string, string>>({})
  if (layout !== 'card' && view.jobs.length === 0 && engineJobs.length === 0) return null
  const liveCount = view.liveCount + engineJobs.filter((j) => j.live).length

  const touch = isRemoteSurface()
  const card = layout === 'card'
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

  const resume = async (id: string): Promise<void> => {
    setResuming((c) => ({ ...c, [id]: true }))
    setResumeMsg((f) => ({ ...f, [id]: '' }))
    try {
      const res = await onResumeEngineJob?.(id)
      if (res && !res.ok) setResumeMsg((f) => ({ ...f, [id]: t(RESUME_FAIL_KEY[res.motivo ?? 'no_existe']) }))
    } catch {
      setResumeMsg((f) => ({ ...f, [id]: t('code.bg.engine.resume.failed') }))
    } finally {
      setResuming((c) => ({ ...c, [id]: false }))
    }
  }

  return (
    <section
      aria-label={t(card ? 'helpers.backgroundCard.title' : 'code.bg.title')}
      className={card ? 'mx-3 my-2' : `mx-auto mb-2 w-full max-w-3xl desk:max-w-[var(--measure-prose)] ${touch ? 'px-3' : 'px-6'}`}
      data-layout={layout}
    >
      <div className="rounded-xl border border-border bg-elevated/60 px-3 py-2 text-[13px]">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium text-muted">
          <Bot size={13} aria-hidden />
          <h3 className="font-medium">{t(card ? 'helpers.backgroundCard.title' : 'code.bg.title')}</h3>
          <span className="text-subtle">{t('code.bg.count', { count: liveCount })}</span>
        </div>
        {view.jobs.length === 0 && engineJobs.length === 0 && <p className="text-xs text-subtle">{t('helpers.backgroundCard.empty')}</p>}
        {view.overLimit && (
          <p role="status" className="mb-1 text-xs text-warning">
            {t('code.bg.over', { count: view.liveCount, shown: MAX_VISIBLE_JOBS })}
          </p>
        )}
        <ul className="flex flex-col gap-1">
          {view.jobs.map((job) => {
            const live = job.state === 'running' || job.state === 'waiting'
            return (
              <li key={job.id}>
                <div className={`flex items-center gap-2 ${card ? 'flex-wrap py-1' : touch ? 'min-h-11 flex-wrap' : ''}`}>
                  <StateIcon state={job.state} />
                  <span
                    className={`min-w-0 flex-1 ${card ? 'basis-[calc(100%-1.5rem)] break-words' : 'truncate'} ${live ? 'text-fg' : 'text-muted'}`}
                    title={job.title}
                  >
                    {onLoadConversation ? (
                      <button
                        type="button"
                        className="text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                        aria-expanded={viewing === job.id}
                        aria-label={t('helpers.viewFor', { title: job.title })}
                        onClick={() => setViewing((id) => (id === job.id ? null : job.id))}
                      >
                        {job.title}
                      </button>
                    ) : (
                      job.title
                    )}
                    {job.agent && <span className="text-subtle"> · {t('code.bg.agent', { agent: job.agent })}</span>}
                    {job.modelName && <span className="block text-muted">{t('helpers.model', { model: job.modelName })}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-muted">{t(STATE_KEY[job.state])}</span>
                  <span className="shrink-0 text-xs tabular-nums text-subtle">{formatElapsed(job.elapsedMs)}</span>
                  {failed[job.id] && (
                    <span role="alert" className="shrink-0 text-xs text-danger">
                      {t(card ? 'code.bg.engine.stopFailed' : 'code.bg.cancelFailed')}
                    </span>
                  )}
                  {live && (
                    <button
                      type="button"
                      disabled={cancelling[job.id]}
                      aria-label={t(card ? 'code.bg.engine.stopFor' : 'code.bg.cancelFor', { title: job.title })}
                      onClick={() => void cancel(job.id)}
                      className={`flex shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${touch ? 'h-11' : 'h-6'}`}
                    >
                      <X size={12} aria-hidden />
                      {t(card ? 'code.bg.engine.stop' : 'code.bg.cancel')}
                    </button>
                  )}
                </div>
                {viewing === job.id && onLoadConversation && (
                  <JobConversation
                    key={job.id}
                    id={job.id}
                    title={job.title}
                    load={onLoadConversation}
                    version={conversationVersion?.(job.id) ?? ''}
                  />
                )}
              </li>
            )
          })}
          {engineJobs.map((job) => (
            <li
              key={`engine:${job.id}`}
              className={`flex items-center gap-2 ${card ? 'flex-wrap py-1' : touch ? 'min-h-11 flex-wrap' : ''}`}
            >
              <EngineStateIcon state={job.state} />
              <span
                className={`min-w-0 flex-1 ${card ? 'basis-[calc(100%-1.5rem)] break-words' : 'truncate'} ${job.live ? 'text-fg' : 'text-muted'}`}
                title={job.title}
              >
                {job.kind === 'ayudante' && onLoadConversation ? (
                  <button
                    type="button"
                    className="text-left hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                    aria-expanded={viewing === job.id}
                    aria-label={t('helpers.viewFor', { title: job.title })}
                    onClick={() => setViewing((id) => (id === job.id ? null : job.id))}
                  >
                    {job.title}
                  </button>
                ) : (
                  job.title
                )}
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
              {resumeMsg[job.id] && (
                <span role="alert" className="shrink-0 text-xs text-danger">
                  {resumeMsg[job.id]}
                </span>
              )}
              {job.resumable && onResumeEngineJob && (
                <button
                  type="button"
                  disabled={resuming[job.id]}
                  aria-label={t('code.bg.engine.resumeFor', { title: job.title })}
                  onClick={() => void resume(job.id)}
                  className={`flex shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50 ${touch ? 'h-11' : 'h-6'}`}
                >
                  <Play size={12} aria-hidden />
                  {t('code.bg.engine.resume')}
                </button>
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
              {viewing === job.id && job.kind === 'ayudante' && onLoadConversation && (
                <div className="w-full">
                  <JobConversation
                    key={job.id}
                    id={job.id}
                    title={job.title}
                    load={onLoadConversation}
                    version={conversationVersion?.(job.id) ?? ''}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/** Vista de lectura de un ayudante, con recarga por eventos y sin cambiar la sesión raíz. */
function JobConversation({
  id,
  title,
  load,
  version
}: {
  id: string
  title: string
  load: (id: string) => Promise<HelperLine[]>
  version: string
}): React.JSX.Element {
  const t = useT()
  const [lines, setLines] = useState<HelperLine[] | null>(null)
  const first = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef({ id, load })
  const alive = useRef(true)
  const request = useRef(0)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
    }
  }, [])
  useEffect(() => {
    latest.current = { id, load }
    const run = (): void => {
      timer.current = null
      const mine = ++request.current
      void latest.current.load(latest.current.id).then(
        (result) => {
          if (alive.current && mine === request.current) {
            setLines(result)
            setFailed(false)
          }
        },
        () => {
          if (alive.current && mine === request.current) setFailed(true)
        }
      )
    }
    if (first.current) {
      first.current = false
      run()
    } else if (timer.current === null) timer.current = setTimeout(run, 1200)
  }, [id, load, version])
  return (
    <div
      role="region"
      aria-label={t('helpers.conv.title', { title })}
      className="my-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-bg/60 p-2 text-xs"
    >
      {failed ? (
        <p role="alert">{t('helpers.conv.failed')}</p>
      ) : lines === null ? (
        <p>{t('helpers.conv.loading')}</p>
      ) : lines.length === 0 ? (
        <p>{t('helpers.conv.empty')}</p>
      ) : (
        lines.map((line) => (
          <div key={line.id} className="mb-2">
            <p className="font-medium text-muted">{t(line.role === 'user' ? 'helpers.conv.user' : 'helpers.conv.assistant')}</p>
            <p className="whitespace-pre-wrap break-words">{line.text}</p>
            {line.tools.length > 0 && (
              <p className="text-subtle">{line.tools.map((tool) => t('helpers.conv.tool', { tool })).join(' · ')}</p>
            )}
          </div>
        ))
      )}
    </div>
  )
}
