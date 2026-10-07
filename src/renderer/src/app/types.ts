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
  /** Acción «Abrir carpeta como proyecto» del encabezado «Proyectos» de la barra lateral de escritorio (solo Code y Tareas). */
  projectAction?: () => void
  /** Muestra la pantalla de "Proyectos recientes" para agregar un proyecto más (no cierra los que ya están abiertos). Solo Code. */
  backToProjects?: () => void
}
