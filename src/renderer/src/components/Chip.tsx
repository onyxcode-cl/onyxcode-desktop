import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Icono de 14 px antes de la etiqueta. */
  icon?: ReactNode
  /** Seleccionado (filtros): acento suave y `aria-pressed`. */
  selected?: boolean
  /** `file` = chip de archivo (mono, radio 6); por defecto, píldora de sugerencia. */
  variant?: 'pill' | 'file'
}

/** Chip pulsable: sugerencias del chat, filtros, chips de modelo y de archivo. 28 px de alto. */
export function Chip({ icon, selected, variant = 'pill', className = '', children, ...rest }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      className={`no-drag inline-flex h-7 shrink-0 items-center gap-1.5 border text-[13px] whitespace-nowrap transition-colors duration-150 select-none disabled:opacity-50 desk:text-ui desk:disabled:cursor-not-allowed ${
        variant === 'file' ? 'rounded-md px-2 font-mono text-xs desk:rounded-ctl-sm desk:text-meta' : 'rounded-full px-3'
      } ${selected ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-elevated text-muted hover:border-border-strong hover:bg-hover hover:text-fg'} ${className}`}
      {...(selected === undefined ? {} : { 'aria-pressed': selected })}
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
