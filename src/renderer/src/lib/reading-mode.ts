import { create } from 'zustand'

/**
 * Modo de lectura de la conversación (preferencia global de este equipo, solo escritorio):
 *  - `summary`: oculta los pasos técnicos (grupos de herramientas, razonamiento); quedan mensajes, entregables,
 *    preguntas, permisos pendientes, errores y el indicador de trabajando.
 *  - `normal`: el comportamiento de siempre.
 *  - `detailed`: los grupos de pasos salen siempre expandidos.
 */
export type ReadingMode = 'summary' | 'normal' | 'detailed'

export const READING_MODES: readonly ReadingMode[] = ['summary', 'normal', 'detailed']

const KEY = 'lazunox.readingMode'

export function parseReadingMode(v: unknown): ReadingMode {
  return v === 'summary' || v === 'detailed' ? v : 'normal'
}

function load(): ReadingMode {
  try {
    return parseReadingMode(localStorage.getItem(KEY))
  } catch {
    return 'normal'
  }
}

interface ReadingModeState {
  mode: ReadingMode
  setMode: (mode: ReadingMode) => void
}

export const useReadingMode = create<ReadingModeState>((set) => ({
  mode: load(),
  setMode: (mode) => {
    try {
      if (mode === 'normal') localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, mode)
    } catch {
      // sin almacenamiento: el cambio vale solo para esta sesión
    }
    set({ mode })
  }
}))

/** Datos mínimos de un grupo de pasos para decidir si se muestra. */
export interface StepGroupFacts {
  /** Alguna llamada del grupo tiene un permiso o una pregunta pendiente. */
  hasPending: boolean
  /** Alguna llamada del grupo terminó con error. */
  hasError: boolean
}

/** ¿Se pinta un grupo de pasos? Nunca se oculta uno con permiso/pregunta pendiente ni con error. */
export function showStepGroup(mode: ReadingMode, g: StepGroupFacts): boolean {
  return mode !== 'summary' || g.hasPending || g.hasError
}

/** ¿Se pinta un bloque de razonamiento («Pensando…»)? Es parte de los pasos técnicos: el resumen lo oculta. */
export function showReasoning(mode: ReadingMode): boolean {
  return mode !== 'summary'
}

/** ¿Los grupos de pasos salen forzados abiertos? */
export function expandStepGroups(mode: ReadingMode): boolean {
  return mode === 'detailed'
}
