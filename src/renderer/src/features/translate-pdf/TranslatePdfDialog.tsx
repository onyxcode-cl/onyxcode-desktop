/**
 * Ventana «Traducir un PDF sin cambiar el diseño» (F8-B200). `<TranslatePdfHost />` se monta una vez en `App.tsx`; el botón del
 * compositor del Chat la abre con `openTranslatePdf()`. La lógica vive en `translate.ts` (probada con un modelo falso).
 */
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { AlertCircle, CheckCircle2, FileText, Languages, Loader2, X } from 'lucide-react'
import { t as tr } from '@shared/i18n'
import { TRANSLATE_LANGS, TRANSLATE_PDF_MAX_BYTES, type PdfFailReason, type TranslateLangCode } from '@shared/translate-pdf'
import { useT } from '../../lib/i18n'
import { call } from '../../lib/api'
import { announce } from '../../lib/announce'
import { useServer } from '../../stores/server'
import { askModel } from '../code/impl/pr/pr-ai'
import { TranslateError, translatePdf, type TranslateDeps, type TranslateOutcome, type TranslateProgress } from './translate'

interface Ui {
  open: boolean
}
const useUi = create<Ui>(() => ({ open: false }))

export function openTranslatePdf(): void {
  useUi.setState({ open: true })
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

function realDeps(): TranslateDeps {
  const dir = useServer.getState().connection?.chatDirectory ?? ''
  return {
    extract: (req) => call('translate:pdfExtract', req),
    apply: (req) => call('translate:pdfApply', req),
    discard: (jobId) => call('translate:pdfDiscard', { jobId }),
    ask: (prompt, signal) => askModel(dir, prompt, { mode: 'chat', signal, timeoutMs: 240_000 })
  }
}

/** Idioma de destino por omisión: el contrario al de la interfaz (quien usa Lazunox en español suele querer el inglés y al revés). */
function defaultTarget(): TranslateLangCode {
  return document.documentElement.lang === 'en' ? 'es' : 'en'
}

type View =
  | { kind: 'pick' }
  | { kind: 'running'; progress: TranslateProgress }
  | { kind: 'done'; outcome: TranslateOutcome; saved: boolean }
  | { kind: 'error'; reason: PdfFailReason | 'model' | 'aborted' | 'tooManyFailures'; detail?: string }

function errorText(reason: string, detail?: string): string {
  const key = `translate.pdf.err.${reason}` as const
  // `reason` viene de un conjunto cerrado; si algún día aparece uno nuevo cae en el mensaje genérico.
  const known = [
    'tooBig',
    'unreadable',
    'encrypted',
    'scanned',
    'tooLong',
    'noPython',
    'unsupported',
    'timeout',
    'failed',
    'model',
    'tooManyFailures',
    'aborted'
  ]
  return tr(known.includes(reason) ? (key as 'translate.pdf.err.failed') : 'translate.pdf.err.failed', { detail: detail ?? '' })
}

export function TranslatePdfHost(): React.JSX.Element | null {
  const open = useUi((s) => s.open)
  return open ? <TranslatePdfDialog /> : null
}

function TranslatePdfDialog(): React.JSX.Element {
  const t = useT()
  const [file, setFile] = useState<File | null>(null)
  const [target, setTarget] = useState<TranslateLangCode>(defaultTarget())
  const [view, setView] = useState<View>({ kind: 'pick' })
  const [fileError, setFileError] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const running = view.kind === 'running'

  const close = (): void => {
    ctrl.current?.abort() // si estaba traduciendo, `translatePdf` borra el trabajo; si ya terminó, el archivo queda hasta el limpiado diario
    useUi.setState({ open: false })
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  })

  const choose = (f: File | undefined): void => {
    setFileError(null)
    if (!f) return
    if (f.type !== 'application/pdf' && !/\.pdf$/i.test(f.name)) return setFileError(tr('translate.pdf.err.unreadable'))
    if (f.size > TRANSLATE_PDF_MAX_BYTES) return setFileError(tr('translate.pdf.err.tooBig'))
    setFile(f)
  }

  const start = async (): Promise<void> => {
    if (!file) return
    const c = new AbortController()
    ctrl.current = c
    setView({ kind: 'running', progress: { phase: 'reading', done: 0, total: 0 } })
    try {
      const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
      const outcome = await translatePdf(realDeps(), {
        name: file.name,
        base64,
        target,
        signal: c.signal,
        onProgress: (progress) => setView({ kind: 'running', progress })
      })
      setView({ kind: 'done', outcome, saved: false })
      announce(tr('translate.pdf.doneTitle', { name: outcome.outName }), 'polite')
    } catch (e) {
      if (e instanceof TranslateError) setView({ kind: 'error', reason: e.reason, detail: e.reason === 'model' ? e.message : undefined })
      else setView({ kind: 'error', reason: 'failed' })
    }
  }

  const sizeMb = file ? (file.size / 1024 / 1024).toFixed(1) : ''

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-6 animate-fade-in"
      onMouseDown={() => !running && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="translate-pdf-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border bg-elevated p-5 shadow-2xl desk:max-w-[460px] desk:p-6 desk:rounded-modal desk:border-transparent desk:shadow-modal desk:animate-rise-in"
        data-testid="translate-pdf-dialog"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 id="translate-pdf-title" className="flex items-center gap-2 text-base font-semibold desk:text-[17px] desk:leading-6">
            <Languages size={17} aria-hidden="true" />
            {t('translate.pdf.title')}
          </h3>
          <button
            type="button"
            onClick={close}
            aria-label={t('translate.pdf.close')}
            className="no-drag -mr-1 flex size-6 shrink-0 items-center justify-center rounded-ctl-sm text-muted hover:bg-hover hover:text-fg"
          >
            <X size={14} />
          </button>
        </div>

        {view.kind === 'pick' && (
          <>
            <p className="mt-3 text-ui text-muted">{t('translate.pdf.intro')}</p>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => input.current?.click()}
                className="no-drag inline-flex shrink-0 items-center gap-2 rounded-ctl border border-border px-3 py-1.5 text-ui hover:bg-hover"
              >
                <FileText size={14} aria-hidden="true" />
                {file ? t('translate.pdf.change') : t('translate.pdf.pick')}
              </button>
              <span className="min-w-0 truncate text-ui text-muted" title={file?.name}>
                {file ? `${file.name} · ${sizeMb} MB` : t('translate.pdf.noFile')}
              </span>
              <input
                ref={input}
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => choose(e.target.files?.[0])}
              />
            </div>
            {fileError && (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                {fileError}
              </p>
            )}
            <label className="mt-4 flex items-center gap-3 text-ui">
              <span className="shrink-0">{t('translate.pdf.lang')}</span>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as TranslateLangCode)}
                className="no-drag min-w-0 flex-1 rounded-ctl border border-border bg-bg px-2 py-1.5 text-ui"
              >
                {TRANSLATE_LANGS.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-3 text-[12px] leading-snug text-muted">{t('translate.pdf.privacy')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} className="no-drag rounded-ctl px-3 py-1.5 text-ui text-muted hover:bg-hover">
                {t('translate.pdf.cancel')}
              </button>
              <button
                type="button"
                disabled={!file}
                onClick={() => void start()}
                className="no-drag rounded-ctl bg-accent px-3.5 py-1.5 text-ui font-medium text-accent-fg disabled:opacity-50"
              >
                {t('translate.pdf.start')}
              </button>
            </div>
          </>
        )}

        {view.kind === 'running' && (
          <>
            <p className="mt-4 flex items-center gap-2 text-ui" role="status">
              <Loader2 size={15} className="animate-spin" aria-hidden="true" />
              {view.progress.phase === 'reading'
                ? t('translate.pdf.reading')
                : view.progress.phase === 'writing'
                  ? t('translate.pdf.writing')
                  : t('translate.pdf.translating', {
                      done: Math.min(view.progress.done + 1, view.progress.total),
                      total: view.progress.total
                    })}
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden="true">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${view.progress.total ? Math.round((view.progress.done / view.progress.total) * 100) : 4}%` }}
              />
            </div>
            <div className="mt-5 flex justify-end">
              <button type="button" onClick={close} className="no-drag rounded-ctl px-3 py-1.5 text-ui text-muted hover:bg-hover">
                {t('translate.pdf.cancel')}
              </button>
            </div>
          </>
        )}

        {view.kind === 'done' && <DoneView view={view} setSaved={() => setView({ ...view, saved: true })} close={close} />}

        {view.kind === 'error' && (
          <>
            <p role="alert" className="mt-4 flex items-start gap-2 text-ui text-danger">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{errorText(view.reason, view.detail)}</span>
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} className="no-drag rounded-ctl px-3 py-1.5 text-ui text-muted hover:bg-hover">
                {t('translate.pdf.close')}
              </button>
              {view.reason !== 'aborted' && file && (
                <button
                  type="button"
                  onClick={() => setView({ kind: 'pick' })}
                  className="no-drag rounded-ctl bg-accent px-3.5 py-1.5 text-ui font-medium text-accent-fg"
                >
                  {t('translate.pdf.retry')}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DoneView({
  view,
  setSaved,
  close
}: {
  view: Extract<View, { kind: 'done' }>
  setSaved: () => void
  close: () => void
}): React.JSX.Element {
  const t = useT()
  const { outcome } = view
  const r = outcome.report
  const notes: string[] = []
  if (r.shrunk > 0) notes.push(t('translate.pdf.doneShrunk', { n: r.shrunk }))
  if (r.overflow.length > 0) notes.push(t('translate.pdf.doneOverflow', { n: r.overflow.length }))
  const untranslated = r.untranslated + outcome.failedSegments
  if (untranslated > 0) notes.push(t('translate.pdf.doneUntranslated', { n: untranslated }))
  if (outcome.pagesWithoutText.length > 0) notes.push(t('translate.pdf.doneNoText', { pages: outcome.pagesWithoutText.join(', ') }))
  if (r.linksDropped > 0) notes.push(t('translate.pdf.doneLinks', { n: r.linksDropped }))
  return (
    <>
      <p className="mt-4 flex items-start gap-2 text-ui font-medium">
        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
        <span className="min-w-0 break-words">{t('translate.pdf.doneTitle', { name: outcome.outName })}</span>
      </p>
      <p className="mt-2 text-ui text-muted">{t('translate.pdf.doneStats', { n: r.translated, pages: outcome.pages })}</p>
      {notes.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[12.5px] text-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="mt-5 flex items-center justify-end gap-2">
        {view.saved && <span className="mr-auto text-[12px] text-muted">{t('translate.pdf.saved')}</span>}
        <button type="button" onClick={close} className="no-drag rounded-ctl px-3 py-1.5 text-ui text-muted hover:bg-hover">
          {t('translate.pdf.close')}
        </button>
        <button
          type="button"
          onClick={() => void call('translate:pdfSave', { jobId: outcome.jobId }).then((s) => s.saved && setSaved())}
          className="no-drag rounded-ctl border border-border px-3 py-1.5 text-ui hover:bg-hover"
        >
          {t('translate.pdf.save')}
        </button>
        <button
          type="button"
          onClick={() => void call('translate:pdfOpen', { jobId: outcome.jobId })}
          className="no-drag rounded-ctl bg-accent px-3.5 py-1.5 text-ui font-medium text-accent-fg"
        >
          {t('translate.pdf.openFile')}
        </button>
      </div>
    </>
  )
}
