/**
 * Exportar / copiar conversaciones (Chat, Code y Tareas): acciones compartidas, aviso breve y diálogo de opciones.
 * `<ExportConversationHost />` se monta una vez (junto al diálogo de confirmación, en `App.tsx`).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { AlertCircle, CheckCircle2, ClipboardCopy, FileDown, FileText, Share, SlidersHorizontal, X } from 'lucide-react'
import { t as tr } from '@shared/i18n'
import { buildConversationMarkdown, type ExportDoc, type ExportOptions } from '@shared/conversation-export'
import { useT } from '../lib/i18n'
import { loadExportOptions, saveExportOptions } from '../lib/conversation/export'
import { getExtras } from '../lib/extrasApi'
import { PortalMenu, PortalMenuItem } from './PortalMenu'

export type ExportAction = 'copy' | 'md' | 'pdf'

interface ExportUi {
  notice: { id: number; text: string; tone: 'success' | 'danger' } | null
  optionsOpen: boolean
  options: ExportOptions
}

const useExportUi = create<ExportUi>(() => ({ notice: null, optionsOpen: false, options: loadExportOptions() }))

let nextNotice = 1
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function notify(text: string, tone: 'success' | 'danger'): void {
  const id = nextNotice++
  useExportUi.setState({ notice: { id, text, tone } })
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => useExportUi.setState((s) => (s.notice?.id === id ? { notice: null } : s)), 7000)
}

export function openExportOptions(): void {
  useExportUi.setState({ optionsOpen: true, options: loadExportOptions() })
}

function redactedNote(count: number): string {
  if (count <= 0) return ''
  return ` ${count === 1 ? tr('conv.export.redacted.one') : tr('conv.export.redacted.many', { count })}`
}

/**
 * Ejecuta una acción sobre una conversación. `getDoc` obtiene la conversación (cargándola si hace falta); `null` = no hay nada.
 * Copiar: portapapeles en Markdown. Guardar: el diálogo «Guardar como» es el nativo de main (el renderer no elige rutas).
 */
export async function runExportAction(action: ExportAction, getDoc: () => Promise<ExportDoc | null>): Promise<void> {
  try {
    const doc = await getDoc()
    if (!doc || doc.turns.length === 0) {
      notify(tr('conv.export.empty'), 'danger')
      return
    }
    const options = loadExportOptions()
    if (action === 'copy') {
      const md = buildConversationMarkdown(doc, options)
      await navigator.clipboard.writeText(md.content)
      notify(tr('conv.export.copied') + redactedNote(md.redactions), 'success')
      return
    }
    const extras = getExtras()
    if (!extras) throw new Error(tr('conv.export.empty'))
    const res = await extras.invoke('extras:exportConversation', {
      format: action,
      doc,
      options,
      lang: document.documentElement.lang === 'en' ? 'en' : 'es'
    })
    if (res.path) notify(tr('conv.export.saved', { path: res.path }) + redactedNote(res.redactions), 'success')
  } catch (err) {
    notify(tr('conv.export.failed', { detail: err instanceof Error ? err.message : String(err) }), 'danger')
  }
}

/** Botón de cabecera «Exportar»: menú con copiar, guardar como Markdown o PDF y las opciones. */
export function ExportMenuButton({ onAction }: { onAction: (action: ExportAction) => void }): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  const close = useCallback(() => setOpen(false), [])
  const pick = (action: ExportAction): void => {
    setOpen(false)
    onAction(action)
  }
  return (
    <div ref={anchor} className="no-drag relative hidden shrink-0 desk:flex" data-testid="export-menu">
      <button
        type="button"
        title={t('conv.export.header')}
        aria-label={t('conv.export.header')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex size-7 items-center justify-center rounded-ctl-sm text-muted hover:bg-hover hover:text-fg"
      >
        <Share size={15} strokeWidth={1.75} />
      </button>
      <PortalMenu open={open} anchor={anchor} onClose={close} label={t('conv.export.header')}>
        <PortalMenuItem icon={<ClipboardCopy size={14} strokeWidth={1.75} />} label={t('conv.export.copy')} onClick={() => pick('copy')} />
        <PortalMenuItem icon={<FileText size={14} strokeWidth={1.75} />} label={t('conv.export.saveMd')} onClick={() => pick('md')} />
        <PortalMenuItem icon={<FileDown size={14} strokeWidth={1.75} />} label={t('conv.export.savePdf')} onClick={() => pick('pdf')} />
        <PortalMenuItem
          icon={<SlidersHorizontal size={14} strokeWidth={1.75} />}
          label={t('conv.export.options')}
          onClick={() => {
            setOpen(false)
            openExportOptions()
          }}
        />
      </PortalMenu>
    </div>
  )
}

export function ExportConversationHost(): React.JSX.Element {
  return (
    <>
      <ExportNotice />
      <ExportOptionsDialog />
    </>
  )
}

function ExportNotice(): React.JSX.Element | null {
  const notice = useExportUi((s) => s.notice)
  if (!notice) return null
  const Icon = notice.tone === 'danger' ? AlertCircle : CheckCircle2
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[330] flex justify-center px-4" data-testid="export-notice">
      <div
        role={notice.tone === 'danger' ? 'alert' : 'status'}
        className="pointer-events-auto flex max-w-xl items-start gap-2 rounded-card bg-fg px-4 py-2.5 text-ui text-bg shadow-pop animate-rise-in"
      >
        <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 break-words">{notice.text}</span>
        <button
          type="button"
          aria-label={tr('conv.export.close')}
          onClick={() => useExportUi.setState({ notice: null })}
          className="no-drag -mr-1 ml-1 flex size-5 shrink-0 items-center justify-center rounded-ctl-sm opacity-70 hover:opacity-100"
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}

function ExportOptionsDialog(): React.JSX.Element | null {
  const t = useT()
  const open = useExportUi((s) => s.optionsOpen)
  const options = useExportUi((s) => s.options)
  const [local, setLocal] = useState(options)
  useEffect(() => setLocal(options), [options, open])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        useExportUi.setState({ optionsOpen: false })
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])
  if (!open) return null
  const set = (patch: Partial<ExportOptions>): void => {
    const next = { ...local, ...patch }
    setLocal(next)
    saveExportOptions(next)
    useExportUi.setState({ options: next })
  }
  const rows: { key: keyof ExportOptions; label: string }[] = [
    { key: 'reasoning', label: t('conv.export.optReasoning') },
    { key: 'tools', label: t('conv.export.optTools') },
    { key: 'attachments', label: t('conv.export.optAttachments') }
  ]
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-fg/30 p-6 animate-fade-in"
      onMouseDown={() => useExportUi.setState({ optionsOpen: false })}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-options-title"
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl border border-border bg-elevated p-5 shadow-2xl desk:max-w-[420px] desk:p-6 desk:rounded-modal desk:border-transparent desk:shadow-modal desk:animate-rise-in"
      >
        <h3 id="export-options-title" className="text-base font-semibold desk:text-[17px] desk:leading-6">
          {t('conv.export.dialogTitle')}
        </h3>
        <div className="mt-4 flex flex-col gap-3">
          {rows.map((r) => (
            <label key={r.key} className="flex cursor-pointer items-center gap-2.5 text-ui">
              <input
                type="checkbox"
                checked={local[r.key]}
                onChange={(e) => set({ [r.key]: e.target.checked })}
                className="size-4 accent-[var(--accent)]"
              />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        <p className="mt-4 text-meta leading-relaxed text-muted">{t('conv.export.privacy')}</p>
        <div className="mt-5 flex justify-end">
          <button
            type="button"
            autoFocus
            onClick={() => useExportUi.setState({ optionsOpen: false })}
            className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 desk:h-10 desk:px-4 desk:py-0 desk:rounded-[10px] desk:hover:opacity-100 desk:hover:bg-accent-hover"
          >
            {t('conv.export.close')}
          </button>
        </div>
      </div>
    </div>
  )
}
