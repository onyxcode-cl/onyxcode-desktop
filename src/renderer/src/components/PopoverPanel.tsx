import type { HTMLAttributes, ReactNode } from 'react'
import { isRemoteSurface } from '../lib/platform'
import { Sheet } from './mobile/Sheet'

interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  open: boolean
  /** Cierra el panel (en el celular, también con Esc, el fondo o el gesto de la hoja). */
  onClose: () => void
  /** Título accesible de la hoja (solo celular). */
  title: string
  size?: 'half' | 'full'
  children: ReactNode
}

/**
 * Punto de montaje común de los menús emergentes. En escritorio es el `<div>` posicionado de siempre (mismo marcado y clases,
 * nada cambia); en la PWA del celular el mismo contenido se muestra dentro de una `Sheet` (hoja inferior modal accesible).
 * Los cierres «al hacer clic fuera» de cada menú deben ignorar lo que está dentro de `[data-sheet]` (la hoja vive en un portal).
 */
export function PopoverPanel({ open, onClose, title, size, children, ...rest }: Props): React.JSX.Element | null {
  if (isRemoteSurface()) {
    // La hoja decide cuándo desmontarse (anima la salida), por eso recibe `open` en vez de devolver null aquí.
    return (
      <Sheet open={open} onClose={onClose} title={title} size={size}>
        <div className="flex flex-col gap-1 p-2">{children}</div>
      </Sheet>
    )
  }
  if (!open) return null
  return <div {...rest}>{children}</div>
}
