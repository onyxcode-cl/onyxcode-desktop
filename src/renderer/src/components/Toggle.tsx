/** Interruptor (role="switch"). `stopPropagation` evita disparar el click de una fila contenedora. */
export function Toggle({
  checked,
  onChange,
  label,
  disabled,
  stopPropagation
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
  stopPropagation?: boolean
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
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 disabled:opacity-40 ${checked ? 'bg-accent' : 'bg-border-strong'}`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${checked ? 'translate-x-4.5' : 'translate-x-0.5'}`}
      />
    </button>
  )
}
