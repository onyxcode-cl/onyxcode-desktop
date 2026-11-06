/**
 * Tarjetas de traducción dentro de la conversación del Chat: una por trabajo, sobre el cuadro de escribir (como los trabajos en
 * segundo plano). Progreso, «Cancelar», resultado con «Abrir» / «Guardar como…» (y la versión limpia de un escaneo) o el error con
 * «Reintentar». La lógica y el estado viven en `jobs.ts`.
 */
import { AlertCircle, CheckCircle2, Languages, Loader2, X } from 'lucide-react'
import type { TranslateLangCode } from '@shared/translate-pdf'
import { useT } from '../../lib/i18n'
import { call } from '../../lib/api'
import {
  cancelTranslateJob,
  dismissTranslateJob,
  markJobSaved,
  retryTranslateJob,
  useTranslateJobs,
  type TranslateJob
} from './jobs'

const KNOWN_ERRORS = [
  'tooBig',
  'unreadable',
  'encrypted',
  'scanned',
  'noText',
  'tooLong',
  'noPython',
  'unsupported',
  'timeout',
  'failed',
  'model',
  'tooManyFailures',
  'aborted'
]

export function TranslateJobs(): React.JSX.Element | null {
  const jobs = useTranslateJobs((s) => s.jobs)
  if (jobs.length === 0) return null
  return (
    <div className="mx-auto w-full max-w-3xl space-y-2 px-6 pb-2 desk:max-w-[calc(var(--measure-prose)+48px)]" data-testid="translate-jobs">
      {jobs.map((j) => (
        <JobCard key={j.id} job={j} />
      ))}
    </div>
  )
}

function JobCard({ job }: { job: TranslateJob }): React.JSX.Element {
  const t = useT()
  const { state, preset } = job
  const lang = t(`translate.pdf.langName.${preset.target as TranslateLangCode}`)
  const btn = 'no-drag rounded-ctl border border-border px-2.5 py-1 text-[12.5px] hover:bg-hover'
  return (
    <section
      aria-label={t('translate.pdf.job.title', { name: preset.name, lang })}
      data-testid="translate-job"
      data-state={state.kind}
      className="rounded-xl border border-border bg-elevated px-4 py-3 shadow-sm"
    >
      <div className="flex items-start gap-2">
        {state.kind === 'running' ? (
          <Loader2 size={15} className="mt-0.5 shrink-0 animate-spin" aria-hidden="true" />
        ) : state.kind === 'done' ? (
          <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        ) : (
          <AlertCircle size={15} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-ui font-medium">
            <Languages size={14} className="shrink-0" aria-hidden="true" />
            <span className="min-w-0 break-words">{t('translate.pdf.job.title', { name: preset.name, lang })}</span>
          </p>
          {state.kind === 'running' && <Running state={state} />}
          {state.kind === 'done' && <Done job={job} state={state} btn={btn} />}
          {state.kind === 'error' && (
            <p role="alert" className="mt-1 break-words text-ui text-danger">
              {t(
                (KNOWN_ERRORS.includes(state.reason) ? `translate.pdf.err.${state.reason}` : 'translate.pdf.err.failed') as 'translate.pdf.err.failed',
                { detail: state.detail ?? '' }
              )}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {state.kind === 'running' && (
            <button type="button" onClick={() => cancelTranslateJob(job.id)} className={btn}>
              {t('translate.pdf.cancel')}
            </button>
          )}
          {state.kind === 'error' && state.reason !== 'aborted' && (
            <button type="button" onClick={() => retryTranslateJob(job.id)} className={btn}>
              {t('translate.pdf.retry')}
            </button>
          )}
          {state.kind !== 'running' && (
            <button
              type="button"
              onClick={() => dismissTranslateJob(job.id)}
              aria-label={t('translate.pdf.job.dismiss')}
              title={t('translate.pdf.job.dismiss')}
              className="no-drag rounded-ctl p-1 text-muted hover:bg-hover"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </section>
  )
}

function Running({ state }: { state: Extract<TranslateJob['state'], { kind: 'running' }> }): React.JSX.Element {
  const t = useT()
  const p = state.progress
  const step = Math.min(p.done + 1, p.total)
  const text =
    p.phase === 'reading'
      ? t('translate.pdf.reading')
      : p.phase === 'writing'
        ? t('translate.pdf.writing')
        : p.phase === 'cleaning'
          ? t('translate.pdf.cleaning', { done: step, total: p.total })
          : t('translate.pdf.translating', { done: step, total: p.total })
  return (
    <>
      <p className="mt-1 text-[12.5px] text-muted" role="status">
        {text}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
        <div
          className="h-full bg-accent transition-[width]"
          style={{ width: `${p.total ? Math.round((p.done / p.total) * 100) : 4}%` }}
        />
      </div>
    </>
  )
}

function Done({
  job,
  state,
  btn
}: {
  job: TranslateJob
  state: Extract<TranslateJob['state'], { kind: 'done' }>
  btn: string
}): React.JSX.Element {
  const t = useT()
  const { outcome } = state
  const r = outcome.report
  const notes: string[] = []
  if (r.shrunk > 0) notes.push(t('translate.pdf.doneShrunk', { n: r.shrunk }))
  if (r.overflow.length > 0) notes.push(t('translate.pdf.doneOverflow', { n: r.overflow.length }))
  const untranslated = r.untranslated + outcome.failedSegments
  if (untranslated > 0) notes.push(t('translate.pdf.doneUntranslated', { n: untranslated }))
  if (outcome.pagesWithoutText.length > 0) notes.push(t('translate.pdf.doneNoText', { pages: outcome.pagesWithoutText.join(', ') }))
  if ((r.formatLost ?? 0) > 0) notes.push(t('translate.pdf.doneFormat', { n: r.formatLost ?? 0 }))
  if ((r.cutOff ?? 0) > 0) notes.push(t('translate.pdf.doneCutOff', { n: r.cutOff ?? 0 }))
  if (r.linksDropped > 0) notes.push(t('translate.pdf.doneLinks', { n: r.linksDropped }))
  const save = (clean: boolean): void => {
    void call('translate:pdfSave', { jobId: outcome.jobId, ...(clean ? { clean: true } : {}) }).then((s) => s.saved && markJobSaved(job.id))
  }
  return (
    <>
      <p className="mt-1 break-words text-ui">{t('translate.pdf.doneTitle', { name: outcome.outName })}</p>
      <p className="mt-0.5 text-[12.5px] text-muted">
        {outcome.kind === 'docx' || outcome.kind === 'xlsx'
          ? t('translate.pdf.doneStatsDoc', { n: r.translated })
          : t('translate.pdf.doneStats', { n: r.translated, pages: outcome.pages })}
      </p>
      {notes.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void call('translate:pdfOpen', { jobId: outcome.jobId })}
          className="no-drag rounded-ctl bg-accent px-3 py-1 text-[12.5px] font-medium text-accent-fg"
        >
          {t('translate.pdf.openFile')}
        </button>
        <button type="button" onClick={() => save(false)} className={btn}>
          {t('translate.pdf.save')}
        </button>
        {state.saved && <span className="text-[12px] text-muted">{t('translate.pdf.saved')}</span>}
      </div>
      {outcome.cleanOutName && (
        <div className="mt-2 rounded-ctl border border-border px-3 py-2">
          <p className="text-[12.5px] text-muted">{t('translate.pdf.cleanNote', { name: outcome.cleanOutName })}</p>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => void call('translate:pdfOpen', { jobId: outcome.jobId, clean: true })} className={btn}>
              {t('translate.pdf.openClean')}
            </button>
            <button type="button" onClick={() => save(true)} className={btn}>
              {t('translate.pdf.saveClean')}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
