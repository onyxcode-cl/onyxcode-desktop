import { useId } from 'react'
import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { INPUT, INPUT_INVALID } from './ui/recipes'

interface FieldProps {
  /** Marca el campo como inválido (`aria-invalid`, borde de peligro). */
  invalid?: boolean
  /** Mensaje de error bajo el campo (implica `invalid`); enlazado con `aria-describedby`. */
  error?: string
}

function ErrorText({ id, error }: { id: string; error: string }): React.JSX.Element {
  return (
    <p id={id} className="mt-1 text-xs text-danger desk:text-meta">
      {error}
    </p>
  )
}

/** Campo de texto: la cadena base de siempre + 32 px, radio 8 y halo de foco en escritorio. */
export function Input({ invalid, error, className = '', ...rest }: InputHTMLAttributes<HTMLInputElement> & FieldProps): React.JSX.Element {
  const errId = useId()
  const bad = invalid || !!error
  return (
    <>
      <input
        className={`${INPUT} desk:h-8 desk:py-0 ${bad ? INPUT_INVALID : ''} ${className}`}
        {...(bad ? { 'aria-invalid': true } : {})}
        {...(error ? { 'aria-describedby': errId } : {})}
        {...rest}
      />
      {error ? <ErrorText id={errId} error={error} /> : null}
    </>
  )
}

/** `<select>` nativo con el chevrón propio (`.select-field`) y espacio para él a la derecha. */
export function Select({
  invalid,
  error,
  className = '',
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & FieldProps): React.JSX.Element {
  const errId = useId()
  const bad = invalid || !!error
  return (
    <>
      <select
        className={`select-field ${INPUT} pr-8 desk:h-8 desk:py-0 ${bad ? INPUT_INVALID : ''} ${className}`}
        {...(bad ? { 'aria-invalid': true } : {})}
        {...(error ? { 'aria-describedby': errId } : {})}
        {...rest}
      />
      {error ? <ErrorText id={errId} error={error} /> : null}
    </>
  )
}
