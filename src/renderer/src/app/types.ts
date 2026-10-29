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
  /**
   * Sustituye la caja «Buscar…» (abre la paleta) de la barra lateral de escritorio por un buscador propio del modo (Tareas: una sola
   * búsqueda, la de sus tareas, en vez de dos). Recibe cómo abrir la paleta y su atajo para seguir ofreciéndola.
   */
  SidebarSearch?: ComponentType<{ openPalette: () => void; paletteHint: string }>
  /** Botón principal de la barra lateral. */
  newAction?: { label: string; run: () => void }
  /**
   * Botón principal de la barra lateral cuando NO es la misma acción que el atajo «nuevo» (⌘N): Code pone «Nuevo proyecto», que abre de una vez el
   * selector de carpeta; las sesiones nuevas se crean con el «+» de cada proyecto o con el atajo. Sin esto el botón usa `newAction`.
   */
  sidebarNew?: { label: string; run: () => void }
  /** Acción «Abrir carpeta como proyecto» del encabezado «Proyectos» de la barra lateral de escritorio (solo Code y Tareas). */
  projectAction?: () => void
  /** Muestra la pantalla de "Proyectos recientes" para agregar un proyecto más (no cierra los que ya están abiertos). Solo Code. */
  backToProjects?: () => void
}
