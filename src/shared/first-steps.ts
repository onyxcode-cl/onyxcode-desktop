/**
 * «Primeros pasos» (módulo PURO): la lista corta de 4 cosas que conviene probar al instalar la app.
 * Cada paso se marca solo cuando la persona lo hace de verdad (modelo elegido, primer mensaje, primer adjunto, Ajustes
 * de instrucciones y memoria); nada se marca por abrir la tarjeta. El estado vive solo en este computador.
 */

export const FIRST_STEP_IDS = ['model', 'message', 'attach', 'settings'] as const
export type FirstStepId = (typeof FIRST_STEP_IDS)[number]

export interface FirstStepsState {
  /** Pasos hechos, en el orden en que se hicieron (sin repetidos). */
  done: FirstStepId[]
  /** La persona la ocultó con «Ocultar» (permanente hasta que la muestre desde Ajustes). */
  hidden: boolean
  /** Ya se completó y se despidió: no vuelve a aparecer salvo que la persona la pida desde Ajustes. */
  finished: boolean
  /** Ya hubo actividad real o ya se comprobó si es una instalación nueva (evita tratar de «recién llegada» a quien ya usaba la app). */
  seeded: boolean
}

export const EMPTY_FIRST_STEPS: FirstStepsState = { done: [], hidden: false, finished: false, seeded: false }

const isStep = (x: unknown): x is FirstStepId => typeof x === 'string' && (FIRST_STEP_IDS as readonly string[]).includes(x)

const fresh = (): FirstStepsState => ({ ...EMPTY_FIRST_STEPS, done: [] })

/** Lee el estado guardado; cualquier cosa rara vuelve al estado inicial (nunca lanza). */
export function parseFirstSteps(raw: string | null | undefined): FirstStepsState {
  if (!raw) return fresh()
  try {
    const v = JSON.parse(raw) as Partial<FirstStepsState> | null
    if (!v || typeof v !== 'object') return fresh()
    const done = Array.isArray(v.done) ? [...new Set(v.done.filter(isStep))] : []
    return { done, hidden: v.hidden === true, finished: v.finished === true, seeded: v.seeded === true || done.length > 0 }
  } catch {
    return fresh()
  }
}

export function serializeFirstSteps(s: FirstStepsState): string {
  return JSON.stringify({ done: s.done, hidden: s.hidden, finished: s.finished, seeded: s.seeded })
}

/** Marca un paso como hecho (idempotente). */
export function markFirstStep(s: FirstStepsState, id: FirstStepId): FirstStepsState {
  if (s.done.includes(id)) return s
  return { ...s, done: [...s.done, id], seeded: true }
}

export function firstStepsProgress(s: FirstStepsState): { done: number; total: number } {
  return { done: FIRST_STEP_IDS.filter((id) => s.done.includes(id)).length, total: FIRST_STEP_IDS.length }
}

export function firstStepsComplete(s: FirstStepsState): boolean {
  const p = firstStepsProgress(s)
  return p.done === p.total
}

/** ¿Se dibuja la tarjeta? Solo si no está oculta ni despedida. */
export function firstStepsVisible(s: FirstStepsState): boolean {
  return !s.hidden && !s.finished
}

/** Quien ya tenía conversaciones antes de que existiera la lista no es «recién llegada»: se oculta sin tocar su progreso. */
export function seedForExistingUser(s: FirstStepsState, hasConversations: boolean): FirstStepsState {
  if (s.seeded) return s
  return hasConversations ? { ...s, seeded: true, hidden: true } : s
}

/** Volver a mostrarla desde Ajustes: si ya se había completado empieza de cero. */
export function showFirstStepsAgain(s: FirstStepsState): FirstStepsState {
  return s.finished || firstStepsComplete(s) ? { done: [], hidden: false, finished: false, seeded: true } : { ...s, hidden: false }
}
