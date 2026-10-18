/**
 * Casilla de un componente opcional en «Preparando Lazunox», el paso «Prepara tu equipo» y la bienvenida: marcada por defecto, con el
 * nombre como etiqueta y el tamaño y el origen (el texto de ayuda) enlazados con `aria-describedby`. Solo presenta; el estado vive en quien la usa.
 */
import { useId } from 'react'

export function ComponentPick({
  id,
  label,
  checked,
  disabled,
  onChange,
  children
}: {
  /** Identificador del componente (para `data-testid`). */
  id: string
  label: string
  checked: boolean
  /** Durante la instalación no se cambia la elección. */
  disabled?: boolean
  onChange: (checked: boolean) => void
  /** Texto de ayuda: tamaño y de dónde se descarga. */
  children?: React.ReactNode
}): React.JSX.Element {
  const hintId = `${useId()}-hint`
  return (
    <>
      <label className="flex items-start gap-2 font-medium text-fg">
        <input
          type="checkbox"
          data-testid={`pick-${id}`}
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={children ? hintId : undefined}
          className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]"
        />
        <span>{label}</span>
      </label>
      {children && (
        <p id={hintId} className="mt-0.5 pl-6 text-muted">
          {children}
        </p>
      )}
    </>
  )
}
