/** Piezas de UI pequeñas y reutilizables dentro del modo Code (tooltips, kbd, segmentado…). */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { t } from '@shared/i18n'
import { dateLocale, useT } from '../../../lib/i18n'

export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = IS_MAC ? '⌘' : 'Ctrl+'

/** Colores de estado (tokens del tema). */
export const ADD_TEXT = 'text-success'
export const DEL_TEXT = 'text-danger'

export function Kbd({ children, className = '' }: { children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <kbd
      className={`inline-flex min-w-[1.25rem] items-center justify-center rounded border border-border bg-bg px-1 font-sans text-[10px] leading-4 font-medium text-muted ${className}`}
    >
      {children}
    </kbd>
  )
}

interface TipProps {
  label: string
  shortcut?: string
  side?: 'top' | 'bottom'
  align?: 'center' | 'end' | 'start'
  children: ReactNode
  className?: string
}

/** Tooltip CSS (sin portal) con atajo opcional. */
export function Tip({ label, shortcut, side = 'bottom', align = 'center', children, className = '' }: TipProps): React.JSX.Element {
  const pos = side === 'bottom' ? 'top-full mt-1.5' : 'bottom-full mb-1.5'
  const al = align === 'center' ? 'left-1/2 -translate-x-1/2' : align === 'end' ? 'right-0' : 'left-0'
  return (
    <span className={`group/tip relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-50 ${pos} ${al} flex items-center gap-1.5 rounded-md border border-border bg-elevated px-2 py-1 text-[11px] font-medium whitespace-nowrap text-fg opacity-0 shadow-lg transition-opacity delay-0 group-hover/tip:opacity-100 group-hover/tip:delay-500`}
      >
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </span>
    </span>
  )
}

/** Botón con confirmación en línea (popover). */
export function ConfirmButton({
  children,
  title,
  body,
  confirmLabel,
  onConfirm,
  disabled,
  className = '',
  align = 'end',
  danger = false
}: {
  children: ReactNode
  title: string
  body?: string
  confirmLabel: string
  onConfirm: () => void | Promise<void>
  disabled?: boolean
  className?: string
  align?: 'start' | 'end'
  danger?: boolean
}): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <span ref={ref} className="relative inline-flex">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} className={className}>
        {children}
      </button>
      {open && (
        <div
          role="alertdialog"
          className={`absolute top-full z-50 mt-1.5 w-72 rounded-xl border border-border bg-elevated p-3 text-left shadow-xl ${align === 'end' ? 'right-0' : 'left-0'}`}
        >
          <div className="text-sm font-medium text-fg">{title}</div>
          {body && <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>}
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2.5 py-1 text-xs font-medium text-muted hover:bg-hover hover:text-fg"
            >
              {t('code.ui.cancel')}
            </button>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={() => {
                setBusy(true)
                void Promise.resolve(onConfirm()).finally(() => {
                  setBusy(false)
                  setOpen(false)
                })
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${danger ? 'bg-danger text-danger-fg' : 'bg-accent text-accent-fg'} hover:opacity-90`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </span>
  )
}

export function timeAgo(ts: number): string {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 60) return t('code.time.now')
  const m = Math.round(s / 60)
  if (m < 60) return t('code.time.minutes', { m })
  const h = Math.round(m / 60)
  if (h < 24) return t('code.time.hours', { h })
  const d = Math.round(h / 24)
  if (d === 1) return t('code.time.yesterday')
  if (d < 30) return t('code.time.days', { d })
  return new Date(ts).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' })
}

/** ¿El foco está en un campo editable? (para no robar atajos de una sola tecla). */
export function isEditableTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  return t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || !!t.closest('.xterm')
}
