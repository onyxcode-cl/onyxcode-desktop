import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  children: ReactNode
  active?: boolean
  /** `sm` = 28px, `md` = 32px (por defecto). */
  size?: 'sm' | 'md'
}

export function IconButton({ label, children, active, size = 'md', className = '', ...rest }: Props): React.JSX.Element {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`no-drag inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-fg active:scale-95 disabled:opacity-40 disabled:hover:bg-transparent ${size === 'sm' ? 'h-7 w-7' : 'h-8 w-8'} ${active ? 'bg-active text-fg' : ''} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
