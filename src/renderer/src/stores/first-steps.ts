/**
 * Estado de «Primeros pasos» en el renderer: la lógica pura vive en `@shared/first-steps`; aquí solo se guarda en
 * localStorage (nada sale de este computador) y se avisa a la interfaz. Los pasos los marcan los eventos reales:
 * `markFirstStepDone('model')` al elegir un modelo, `'message'` cuando el motor acepta el primer mensaje, `'attach'`
 * al añadir un archivo y `'settings'` al abrir Ajustes › Instrucciones o Memoria.
 */
import { create } from 'zustand'
import {
  EMPTY_FIRST_STEPS,
  firstStepsComplete,
  markFirstStep,
  parseFirstSteps,
  seedForExistingUser,
  serializeFirstSteps,
  showFirstStepsAgain,
  type FirstStepId,
  type FirstStepsState
} from '@shared/first-steps'

const KEY = 'firstSteps.v1'

function load(): FirstStepsState {
  try {
    return parseFirstSteps(localStorage.getItem(KEY))
  } catch {
    return { ...EMPTY_FIRST_STEPS, done: [] }
  }
}

function save(s: FirstStepsState): void {
  try {
    localStorage.setItem(KEY, serializeFirstSteps(s))
  } catch {
    // sin storage: el progreso vale mientras la app siga abierta
  }
}

interface FirstStepsStore {
  state: FirstStepsState
  /** Mensaje de despedida visible (transitorio: no se guarda). */
  celebrating: boolean
  mark: (id: FirstStepId) => void
  /** Hubo actividad real: ya no se la toma por usuaria antigua. */
  noteActivity: () => void
  /** Al cargar la lista de conversaciones: quien ya tenía conversaciones no ve la lista. */
  seed: (hasConversations: boolean) => void
  hide: () => void
  show: () => void
  /** Cierra la despedida: la lista ya no vuelve (salvo desde Ajustes). */
  finish: () => void
}

export const useFirstSteps = create<FirstStepsStore>((set, get) => {
  const commit = (state: FirstStepsState, extra: Partial<FirstStepsStore> = {}): void => {
    save(state)
    set({ state, ...extra })
  }
  return {
    state: load(),
    celebrating: false,
    mark: (id) => {
      const cur = get().state
      if (cur.done.includes(id)) return
      const next = markFirstStep(cur, id)
      // Solo despide quien la tiene a la vista; si estaba oculta, completar no muestra nada.
      const celebrate = firstStepsComplete(next) && !next.hidden && !next.finished
      commit(next, celebrate ? { celebrating: true } : {})
    },
    noteActivity: () => {
      const cur = get().state
      if (!cur.seeded) commit({ ...cur, seeded: true })
    },
    seed: (hasConversations) => {
      const cur = get().state
      const next = seedForExistingUser(cur, hasConversations)
      if (next !== cur) commit(next)
    },
    hide: () => commit({ ...get().state, hidden: true }, { celebrating: false }),
    show: () => commit(showFirstStepsAgain(get().state), { celebrating: false }),
    finish: () => commit({ ...get().state, finished: true }, { celebrating: false })
  }
})

export function markFirstStepDone(id: FirstStepId): void {
  useFirstSteps.getState().mark(id)
}

export function noteFirstStepsActivity(): void {
  useFirstSteps.getState().noteActivity()
}
