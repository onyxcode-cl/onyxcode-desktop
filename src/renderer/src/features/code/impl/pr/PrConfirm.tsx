/**
 * Cuadro de confirmación de una acción que SALE del equipo (subir, abrir un pull request, publicar una revisión). Muestra exactamente
 * qué rama, qué remoto y qué texto; la acción solo ocurre con el botón de confirmar. Con `typed` (ramas principales) el botón
 * exige escribir el nombre exacto: confirmación reforzada.
 */
import { useEffect, useId, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useT } from '../../../../lib/i18n'
import { isImeComposing } from '../../../../lib/textarea'

export interface ConfirmRow {
  label: string
  value: string
  mono?: boolean
}

interface Props {
  title: string
  warn: string
  rows: ConfirmRow[]
  /** Texto largo que se va a enviar (descripción, comentarios): se muestra tal cual, con scroll. */
  text?: { label: string; value: string }
  extra?: React.ReactNode
  /** Confirmación reforzada: la persona escribe `expected` para habilitar el botón. */
  typed?: { expected: string; prompt: string; label: string }
  confirmLabel: string
  busy: boolean
  error: string | null
  onConfirm: (typed: string) => void
  onCancel: () => void
}

export function PrConfirm({
  title,
  warn,
  rows,
  text,
  extra,
  typed,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  const t = useT()
  const titleId = useId()
  const [typedValue, setTypedValue] = useState('')
  const ready = !typed || typedValue === typed.expected

  useEffect(() => {
    // Esc cierra SOLO este cuadro (no el que está debajo).
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || busy) return
      e.stopImmediatePropagation()
      e.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, onCancel])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-6"
      data-pr-confirm=""
      onMouseDown={() => !busy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-elevated shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <AlertTriangle size={16} className="shrink-0 text-warning" aria-hidden="true" />
          <h2 id={titleId} className="text-sm font-semibold">
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          <p className="rounded-lg bg-warning/10 px-2.5 py-2 text-xs leading-relaxed text-fg">{warn}</p>
          <dl className="space-y-1.5 text-xs">
            {rows.map((r) => (
              <div key={r.label} className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted">{r.label}</dt>
                <dd className={`min-w-0 flex-1 break-words ${r.mono ? 'font-mono' : ''}`}>{r.value}</dd>
              </div>
            ))}
          </dl>
          {text && (
            <div>
              <div className="mb-1 text-xs font-medium text-muted">{text.label}</div>
              <pre className="max-h-48 overflow-auto rounded-lg border border-border bg-bg p-2 font-sans text-xs leading-relaxed break-words whitespace-pre-wrap">
                {text.value || '—'}
              </pre>
            </div>
          )}
          {extra}
          {typed && (
            <div>
              <label htmlFor={`${titleId}-typed`} className="mb-1 block text-xs font-medium">
                {typed.prompt}
              </label>
              <input
                id={`${titleId}-typed`}
                value={typedValue}
                onChange={(e) => setTypedValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && ready && !busy && !isImeComposing(e)) onConfirm(typedValue)
                }}
                autoComplete="off"
                spellCheck={false}
                aria-label={typed.label}
                className="w-full rounded-lg border border-border bg-bg px-2.5 py-1.5 font-mono text-sm outline-none focus:border-border-strong"
              />
            </div>
          )}
          {error && (
            <div role="alert" className="rounded-lg bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
          >
            {t('pr.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(typedValue)}
            disabled={!ready || busy}
            aria-busy={busy}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-fg hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
            {busy ? t('pr.confirm.working') : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
