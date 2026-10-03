import type { ReactNode } from 'react'

/** Fila táctil de una hoja de acciones (≥ 44 px). */
export function SheetAction({
  icon,
  label,
  onClick,
  disabled,
  danger
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 border-b border-border px-4 text-left text-[15px] font-medium hover:bg-hover disabled:opacity-40 ${danger ? 'text-danger' : 'text-fg'}`}
    >
      <span className={`shrink-0 ${danger ? '' : 'text-muted'}`}>{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
    </button>
  )
}
