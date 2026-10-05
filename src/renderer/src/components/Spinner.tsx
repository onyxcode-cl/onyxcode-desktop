import { Loader2 } from 'lucide-react'

/** Tamaños de la escala de iconos (12 en meta, 14 en botones, 16 en cabeceras, 20 en estados vacíos). */
export type SpinnerSize = 12 | 14 | 16 | 20

interface Props {
  size?: SpinnerSize
  className?: string
  /** Etiqueta accesible: con ella el giro suelto pasa a `role="status"`. Sin ella queda decorativo (`aria-hidden`). */
  label?: string
}

/**
 * Indicador de carga único. Pinta EXACTAMENTE lo que ya se escribía a mano (`<Loader2 size={n} className="animate-spin …" />`:
 * misma clase y mismo orden), así que migrar un uso no cambia el marcado ni el celular. En escritorio gira a 0,8 s (base.css).
 */
export function Spinner({ size = 14, className = '', label }: Props): React.JSX.Element {
  return (
    <Loader2
      size={size}
      className={`animate-spin${className ? ` ${className}` : ''}`}
      {...(label ? { role: 'status', 'aria-label': label, 'aria-hidden': undefined } : {})}
    />
  )
}
