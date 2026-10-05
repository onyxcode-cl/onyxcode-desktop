import type { ReactNode } from 'react'
import { LAYER } from './layers'

interface ScrimProps {
  /** `top`: panel pegado arriba (paleta de comandos); `center`: diálogo centrado. */
  align?: 'center' | 'top'
  /** Se llama al pulsar sobre el velo (fuera del contenido). */
  onDismiss?: () => void
  layer?: keyof typeof LAYER
  children: ReactNode
}

/**
 * Velo de los modales de ESCRITORIO (no se usa en el celular): oscurece siempre (`--scrim`), cierra al pulsar fuera y fija la capa.
 * El contenido debe llevar `role="dialog" aria-modal="true"` y su etiqueta; el foco lo gestiona quien lo monta.
 */
export function DialogScrim({ align = 'center', onDismiss, layer = 'dialog', children }: ScrimProps): React.JSX.Element {
  return (
    <div
      className={`fixed inset-0 ${LAYER[layer]} flex animate-fade-in justify-center bg-(--scrim) px-4 ${align === 'top' ? 'items-start pt-[14vh]' : 'items-center p-6'}`}
      onMouseDown={(e) => e.target === e.currentTarget && onDismiss?.()}
    >
      {children}
    </div>
  )
}
