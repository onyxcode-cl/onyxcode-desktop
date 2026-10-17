import { create } from 'zustand'

/**
 * Vista del trabajo del agente (preferencia de este equipo, solo escritorio). Cada respuesta con herramientas se pliega
 * en una línea «Trabajó durante 6 s · 4 pasos» (`WorkFold`); la vista decide cuánto se ve sin abrirla:
 *  - `summary` (Resumida): solo esa línea; al abrirla salen los pasos, una línea por paso.
 *  - `normal` (Con pasos): la línea y, debajo, qué hizo («Leyó 3 archivos · Editó 1 archivo») con los archivos editados.
 *  - `detailed` (Detallada): siempre abierta, con el razonamiento y todos los pasos.
 * El valor interno `normal` se conserva por compatibilidad (Tareas y lo ya guardado); su nombre visible es «Con pasos».
 * Se guarda por superficie: Chat arranca Resumida (se lee la respuesta, no el trabajo) y Code «Con pasos» (se quiere ver
 * qué archivos se tocaron sin abrir nada). Tareas usa la de Code.
 */
export type ReadingMode = 'summary' | 'normal' | 'detailed'

export const READING_MODES: readonly ReadingMode[] = ['summary', 'normal', 'detailed']

export type WorkSurface = 'chat' | 'code'

/** Vista por defecto de cada superficie mientras la persona no elija otra. */
export const DEFAULT_WORK_VIEW: Record<WorkSurface, ReadingMode> = { chat: 'summary', code: 'normal' }

const KEYS: Record<WorkSurface, string> = { chat: 'lazunox.workView.chat', code: 'lazunox.workView.code' }
/** Clave de cuando la preferencia era una sola para todo el equipo (solo se lee, no se escribe). */
const LEGACY_KEY = 'lazunox.readingMode'

export function parseReadingMode(v: unknown): ReadingMode {
  return v === 'summary' || v === 'detailed' ? v : 'normal'
}

/** Valor guardado válido o `null` (= sin elección: manda el predeterminado de la superficie). */
export function parseStoredView(v: unknown): ReadingMode | null {
  return v === 'summary' || v === 'normal' || v === 'detailed' ? v : null
}

function loadOne(surface: WorkSurface): ReadingMode | null {
  try {
    const own = parseStoredView(localStorage.getItem(KEYS[surface]))
    if (own) return own
    // Preferencia global anterior: solo sus dos valores no predeterminados significaban una elección.
    const legacy = localStorage.getItem(LEGACY_KEY)
    return legacy === 'summary' || legacy === 'detailed' ? legacy : null
  } catch {
    return null
  }
}

type Stored = Record<WorkSurface, ReadingMode | null>

interface ReadingModeState {
  /** Elección guardada por superficie; `null` = el predeterminado. */
  stored: Stored
  setView: (surface: WorkSurface, mode: ReadingMode) => void
}

export const useReadingMode = create<ReadingModeState>((set) => ({
  stored: { chat: loadOne('chat'), code: loadOne('code') },
  setView: (surface, mode) => {
    try {
      localStorage.setItem(KEYS[surface], mode)
    } catch {
      // sin almacenamiento: el cambio vale solo para esta sesión
    }
    set((s) => ({ stored: { ...s.stored, [surface]: mode } }))
  }
}))

/** Vista efectiva de una superficie (la elegida o la predeterminada). */
export function useWorkView(surface: WorkSurface): ReadingMode {
  return useReadingMode((s) => s.stored[surface] ?? DEFAULT_WORK_VIEW[surface])
}

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

/** Forma mínima de una parte de un grupo de pasos (herramienta o razonamiento). */
export interface StepPartFacts {
  type: string
  callID?: string
  state?: { status: string }
}

/**
 * Partes que se pintan de un grupo de pasos según el modo, o `null` si el grupo entero se oculta.
 * En `summary` el razonamiento se quita y el grupo solo sobrevive con permiso/pregunta pendiente o error.
 */
export function visibleStepParts<T extends StepPartFacts>(
  mode: ReadingMode,
  parts: readonly T[],
  pendingCallIDs: ReadonlySet<string>
): T[] | null {
  if (mode !== 'summary') return [...parts]
  const hasPending = parts.some((p) => p.type === 'tool' && !!p.callID && pendingCallIDs.has(p.callID))
  const hasError = parts.some((p) => p.type === 'tool' && p.state?.status === 'error')
  if (!showStepGroup(mode, { hasPending, hasError })) return null
  return parts.filter((p) => p.type !== 'reasoning' || showReasoning(mode))
}
