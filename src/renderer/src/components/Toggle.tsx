/** Interruptor (role="switch"). `stopPropagation` evita disparar el click de una fila contenedora. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  stopPropagation,
  size = 'md'
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  stopPropagation?: boolean
  /** `md` = 36×20 (por defecto), `sm` = 28×16 (filas densas). */
  size?: 'sm' | 'md'
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        if (stopPropagation) e.stopPropagation()
        onChange(!checked)
      }}
      className={`relative inline-flex ${size === 'sm' ? 'h-4 w-7' : 'h-5 w-9'} shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40 desk:disabled:cursor-not-allowed desk:disabled:opacity-50 ${checked ? 'bg-accent' : 'bg-border-strong desk:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--fg)_18%,transparent)]'}`}
    >
      <span
        className={`inline-block ${size === 'sm' ? 'h-3 w-3' : 'h-4 w-4'} rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${checked ? (size === 'sm' ? 'translate-x-3.5' : 'translate-x-4.5') : 'translate-x-0.5'}`}
      />
    </button>
  )
}
