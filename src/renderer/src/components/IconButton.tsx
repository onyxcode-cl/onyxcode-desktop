import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
  active?: boolean
}

export function IconButton({ label, children, active, className = '', ...rest }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`no-drag inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent ${active ? 'bg-active text-fg' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
