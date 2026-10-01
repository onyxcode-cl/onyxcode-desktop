import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg shadow-xs hover:bg-accent-hover',
  secondary: 'bg-elevated text-fg border border-border shadow-xs hover:bg-hover hover:border-border-strong',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  danger: 'bg-danger text-danger-fg shadow-xs hover:brightness-110'
}

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-[13px] gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-2'
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

export function Button({ variant = 'secondary', size = 'md', className = '', ...rest }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      className={`no-drag inline-flex items-center justify-center rounded-lg font-medium transition-[background-color,border-color,color,filter,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}
