/**
 * Chip de la fila inferior de la caja de escribir + menú de opciones (Code, Overdrive, Chat).
 * Cada opción lleva una frase que dice QUÉ PASARÁ (no solo el nombre), la actual va marcada y, si existe, su atajo.
 * - Teclado: el menú se abre con Enter/Espacio/↓ en el chip, enfoca la opción actual; ↑ ↓ Inicio Fin recorren, Enter elige,
 *   1-9 eligen la opción con ese número, Esc cierra y devuelve el foco al chip. Roles: `menu` + `menuitemradio`.
 * - Responsive: la etiqueta se oculta (queda solo el ícono) cuando el contenedor (`@container` de la fila) es más angosto que
 *   `collapseClass`; el nombre accesible y el `title` llevan SIEMPRE la etiqueta y el valor actual, así que la información no desaparece.
 * - En el celular (PWA) el mismo contenido sale en una hoja inferior.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Sheet } from './mobile/Sheet'
import { useDismiss } from '../lib/use-dismiss'
import { isMacPlatform, isRemoteSurface } from '../lib/platform'

export interface ChipMenuOption {
  id: string
  label: string
  /** Frase explicativa: qué pasará al elegirla. */
  hint?: string
  icon?: React.ReactNode
  /** Atajo de teclado ya formateado para la plataforma (p. ej. «⇧Tab»). */
  shortcut?: string
  /** Color de aviso (opción peligrosa o que no es la predeterminada). */
  tone?: 'danger' | 'warning'
  disabled?: boolean
}

/** Texto de la tecla modificadora principal: ⌘ en Mac, Ctrl en el resto. */
export const modLabel = (): string => (isMacPlatform() ? '⌘' : 'Ctrl+')

interface Props {
  /** Nombre del ajuste («Modo de permisos»): va al `title`, al `aria-label` y al encabezado del menú. */
  name: string
  /** Etiqueta del valor actual («Preguntar siempre»). */
  valueLabel: string
  icon?: React.ReactNode
  options: ChipMenuOption[]
  value: string
  onSelect: (id: string) => void
  /** Clases de contenedor que ocultan la etiqueta visible (queda `sr-only`), p. ej. la variante de contenedor angosto con sr-only. */
  collapseClass?: string
  /** Estilo del chip cuando el valor es especial (p. ej. «Todo sin preguntar»). */
  tone?: 'danger' | 'warning' | 'accent'
  /** Atajo del chip entero (se muestra en el `title`). */
  chipShortcut?: string
  /** Hacia dónde abre el menú; la composición vive abajo, así que por defecto arriba. */
  align?: 'left' | 'right'
  disabled?: boolean
  /** Ancla de pruebas. */
  testId?: string
  className?: string
}

const chipBase = (): string =>
  `no-drag flex items-center whitespace-nowrap gap-1.5 rounded-md px-2 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent desk:rounded-lg desk:text-[13px] ${isRemoteSurface() ? 'h-11 rounded-xl px-3' : 'h-7'}`

export function ChipMenu({
  name,
  valueLabel,
  icon,
  options,
  value,
  onSelect,
  collapseClass = '',
  tone,
  chipShortcut,
  align = 'left',
  disabled,
  testId,
  className = ''
}: Props): React.JSX.Element {
  const sheet = isRemoteSurface()
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const close = useCallback((): void => setOpen(false), [])
  const rootRef = useDismiss(open && !sheet, close)

  // Al abrir, el foco va a la opción actual (o a la primera).
  useEffect(() => {
    if (!open) return
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])
    ;(items.find((el) => el.getAttribute('aria-checked') === 'true') ?? items[0])?.focus()
  }, [open])

  const pick = (id: string): void => {
    setOpen(false)
    triggerRef.current?.focus()
    if (id !== value) onSelect(id)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (e.key === 'Tab') {
      setOpen(false)
      return
    }
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') ?? [])
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const go = (n: number): void => {
      e.preventDefault()
      items[(n + items.length) % items.length]?.focus()
    }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(items.length - 1)
    else if (/^[1-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      const opt = options[Number(e.key) - 1]
      if (opt && !opt.disabled) {
        e.preventDefault()
        pick(opt.id)
      }
    }
  }

  const onTriggerKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  const toneClass =
    tone === 'danger'
      ? 'bg-danger/10 text-danger'
      : tone === 'accent'
        ? 'bg-accent-soft text-accent'
        : tone === 'warning'
          ? 'bg-warning/10 text-warning'
          : 'text-muted hover:bg-hover hover:text-fg'
  const full = `${name}: ${valueLabel}`

  const items = options.map((o, n) => (
    <button
      key={o.id}
      type="button"
      role="menuitemradio"
      aria-checked={o.id === value}
      disabled={o.disabled}
      data-option={o.id}
      onClick={() => pick(o.id)}
      className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50 ${sheet ? 'min-h-12 py-2.5' : 'py-1.5'} ${
        o.tone === 'danger' ? 'text-danger' : o.tone === 'warning' ? 'text-warning' : o.id === value ? 'text-fg' : 'text-muted'
      }`}
    >
      {o.icon && <span className="mt-0.5 shrink-0">{o.icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{o.label}</span>
        {o.hint && <span className="block text-[11.5px] leading-snug text-subtle desk:text-meta">{o.hint}</span>}
      </span>
      {(o.shortcut ?? (!sheet && n < 9 ? String(n + 1) : null)) && (
        <kbd className="mt-0.5 shrink-0 rounded border border-border px-1 font-sans text-[10.5px] leading-4 text-subtle desk:text-meta">
          {o.shortcut ?? String(n + 1)}
        </kbd>
      )}
      {o.id === value ? <Check size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden /> : <span className="w-3.5 shrink-0" />}
    </button>
  ))

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        data-testid={testId}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={full}
        title={chipShortcut ? `${full} (${chipShortcut})` : full}
        className={`${chipBase()} ${toneClass} ${open ? 'bg-hover text-fg' : ''} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {icon}
        <span className={`whitespace-nowrap ${collapseClass}`}>{valueLabel}</span>
        <ChevronDown
          size={12}
          aria-hidden
          className={`shrink-0 opacity-70 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {sheet ? (
        <Sheet open={open} onClose={close} title={name} size="half">
          <div role="menu" aria-label={name} onKeyDown={onKeyDown} ref={menuRef} className="p-2">
            {items}
          </div>
        </Sheet>
      ) : (
        open && (
          <div
            ref={menuRef}
            role="menu"
            aria-label={name}
            onKeyDown={onKeyDown}
            className={`absolute bottom-full z-50 mb-2 max-h-[min(24rem,calc(100vh-12rem))] w-72 animate-pop-in overflow-y-auto rounded-xl border border-border bg-elevated p-1 shadow-xl ${align === 'right' ? 'right-0 origin-bottom-right' : 'left-0 origin-bottom-left'}`}
          >
            <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-semibold text-subtle desk:text-meta">{name}</div>
            {items}
          </div>
        )
      )}
    </div>
  )
}
