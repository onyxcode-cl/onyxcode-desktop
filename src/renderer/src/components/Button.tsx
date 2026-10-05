import type { ButtonHTMLAttributes } from 'react'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle' | 'link'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

// Las clases con prefijo desk son la variante de escritorio (alturas 24/28/32/36, radio 8, texto 13, solo el primario se encoge al presionar);
// el celular conserva exactamente las clases de siempre. Las variantes `subtle` y `link` y los tamaños `xs`/`lg` son nuevos.
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-xs hover:bg-accent-hover desk:active:scale-[0.97] desk:disabled:shadow-none',
  secondary:
    'bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong desk:active:scale-100 desk:disabled:shadow-none',
  ghost: 'text-muted hover:bg-hover hover:text-fg desk:active:scale-100',
  danger: 'bg-danger text-danger-fg shadow-xs hover:brightness-110 desk:active:scale-100 desk:disabled:shadow-none',
  subtle: 'bg-accent-soft text-accent hover:brightness-95 desk:active:scale-100',
  link: 'text-accent underline-offset-2 hover:underline desk:active:scale-100'
}

const SIZES: Record<ButtonSize, string> = {
  xs: 'px-2 py-0.5 text-xs gap-1.5 desk:h-6 desk:py-0 desk:text-meta desk:rounded-ctl-sm',
  sm: 'px-2.5 py-1 text-[13px] gap-1.5 desk:h-7 desk:py-0 desk:text-ui desk:rounded-ctl',
  md: 'px-3 py-1.5 text-sm gap-2 desk:h-8 desk:py-0 desk:text-ui desk:rounded-ctl',
  lg: 'px-4 py-2 text-sm gap-2 desk:h-9 desk:py-0 desk:text-ui desk:rounded-ctl'
}

// `link` es texto en línea: solo toma el tamaño de letra, sin altura fija ni relleno de botón.
const LINK_SIZES: Record<ButtonSize, string> = {
  xs: 'gap-1 text-xs desk:text-meta desk:rounded-ctl-sm',
  sm: 'gap-1 text-[13px] desk:text-ui desk:rounded-ctl-sm',
  md: 'gap-1.5 text-sm desk:text-ui desk:rounded-ctl-sm',
  lg: 'gap-1.5 text-sm desk:text-ui desk:rounded-ctl-sm'
}

const SPINNER = { xs: 12, sm: 14, md: 14, lg: 14 } as const

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Ocupado: muestra el `Spinner` antes de la etiqueta (que sigue visible), deshabilita el botón y marca `aria-busy`. */
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  disabled,
  className = '',
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={`no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 desk:disabled:cursor-not-allowed ${(variant === 'link' ? LINK_SIZES : SIZES)[size]} ${VARIANTS[variant]} ${className}`}
      disabled={disabled || loading}
      {...(loading ? { 'aria-busy': true } : {})}
      {...rest}
    >
      {loading && <Spinner size={SPINNER[size]} />}
      {children}
    </button>
  )
}
