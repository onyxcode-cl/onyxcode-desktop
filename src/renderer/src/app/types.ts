import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { ModeId } from '@shared/types'

/**
 * Definición de un modo (Chat, Code, Tareas, Rutinas). Cada feature exporta la suya
 * desde `features/<modo>/index.ts` y se registra con UNA línea en `app/modes.ts`.
 */
export interface ModeDefinition {
  id: ModeId
  label: string
  icon: LucideIcon
  /** Vista principal (área derecha). */
  View: ComponentType
  /** Contenido de la barra lateral bajo el botón "nuevo" (lista de sesiones, etc.). */
  SidebarContent?: ComponentType
  /** Botón principal de la barra lateral. */
  newAction?: { label: string; run: () => void }
}
