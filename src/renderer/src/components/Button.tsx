import type { ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg hover:opacity-90',
  secondary: 'bg-elevated text-fg border border-border hover:bg-hover',
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  danger: 'bg-danger text-white hover:opacity-90'
}

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
}

export function Button({ variant = 'secondary', className = '', ...rest }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      className={`no-drag inline-flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  )
}
