/**
 * «Traducir un PDF o Word»: solo el SELECTOR (archivo e idioma). La traducción en sí corre como un trabajo dentro de la conversación
 * (`jobs.ts` + `TranslateJobs.tsx`): al pulsar «Traducir» esta ventana se cierra y el progreso y el resultado aparecen en una
 * tarjeta sobre el cuadro de escribir. `<TranslatePdfHost />` se monta una vez en `App.tsx`; el botón del compositor la abre con
 * `openTranslatePdf()`, y con un archivo e idioma ya decididos (la tarjeta «Traducir así») no se abre ninguna ventana.
 */
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { FileText, Languages, X } from 'lucide-react'
import { t as tr } from '@shared/i18n'
import { TRANSLATE_LANGS, TRANSLATE_PDF_MAX_BYTES, type TranslateLangCode } from '@shared/translate-pdf'
import { useT } from '../../lib/i18n'
import { chatModelInfo } from './model-info'
import { bytesToBase64, fileKind, startTranslateJob, type TranslatePreset } from './jobs'

export type { TranslatePreset } from './jobs'

interface Ui {
  open: boolean
}
const useUi = create<Ui>(() => ({ open: false }))

/** Sin argumentos abre el selector; con un archivo e idioma ya decididos arranca el trabajo directamente (sin ventana). */
export function openTranslatePdf(preset?: TranslatePreset): void {
  if (preset) startTranslateJob(preset)
  else useUi.setState({ open: true })
}

/** Idioma de destino por omisión: el contrario al de la interfaz (quien usa Lazunox en español suele querer el inglés y al revés). */
function defaultTarget(): TranslateLangCode {
  return document.documentElement.lang === 'en' ? 'es' : 'en'
}

export function TranslatePdfHost(): React.JSX.Element | null {
  const open = useUi((s) => s.open)
  return open ? <TranslatePdfDialog /> : null
}

function TranslatePdfDialog(): React.JSX.Element {
  const t = useT()
  const [file, setFile] = useState<File | null>(null)
  const [target, setTarget] = useState<TranslateLangCode>(defaultTarget())
  const model = useRef(chatModelInfo()).current
  const [fileError, setFileError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const close = (): void => useUi.setState({ open: false })

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
    if (!fileKind(f)) return setFileError(tr('translate.pdf.err.unreadable'))
    if (f.size > TRANSLATE_PDF_MAX_BYTES) return setFileError(tr('translate.pdf.err.tooBig'))
    setFile(f)
  }

  const start = async (): Promise<void> => {
    if (!file) return
    const base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()))
    startTranslateJob({ name: file.name, base64, kind: fileKind(file) ?? 'pdf', target })
    close()
  }

  const sizeMb = file ? (file.size / 1024 / 1024).toFixed(1) : ''

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-6 animate-fade-in" onMouseDown={close}>
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
            accept="application/pdf,.pdf,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
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
                {t(`translate.pdf.langName.${l.code}`)}
              </option>
            ))}
          </select>
        </label>
        {model && (
          <p className="mt-3 text-[12px] leading-snug text-muted">
            {t('translate.pdf.model', { model: model.label })}
            {model.free && <span className="mt-1 block text-warning">{t('translate.pdf.modelFree')}</span>}
          </p>
        )}
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
      </div>
    </div>
  )
}
