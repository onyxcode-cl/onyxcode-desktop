/**
 * Derivación del «plan visible» de Code: de la lista de tareas del agente (todos) saca el conteo de pasos listos,
 * el paso en curso y el estado visual de cada paso. Puro y sin React para probarlo aparte.
 */
import type { Todo } from './types'

export type PlanStepState = 'done' | 'active' | 'pending'

export interface PlanStep {
  content: string
  state: PlanStepState
}

export interface PlanView {
  steps: PlanStep[]
  /** Pasos hechos (completados o cancelados). */
  done: number
  total: number
  /** Índice del primer paso en curso; -1 si no hay. */
  activeIndex: number
  /** Todo hecho: la tarjeta se pliega sola. */
  complete: boolean
}

const isDone = (s: string): boolean => s === 'completed' || s === 'cancelled'

/** Null si no hay pasos (entonces no se muestra nada). */
export function derivePlan(todos: readonly Pick<Todo, 'content' | 'status'>[] | undefined): PlanView | null {
  if (!todos || todos.length === 0) return null
  const steps: PlanStep[] = todos.map((x) => ({
    content: x.content,
    state: isDone(x.status) ? 'done' : x.status === 'in_progress' ? 'active' : 'pending'
  }))
  const done = steps.filter((s) => s.state === 'done').length
  return { steps, done, total: steps.length, activeIndex: steps.findIndex((s) => s.state === 'active'), complete: done === steps.length }
}

/** «0:14», «1:05», «1:02:03». */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Clave estable del paso en curso para el cronómetro: cambia cuando pasa a otro paso. */
export function activeKey(view: PlanView | null): string | null {
  return view && view.activeIndex >= 0 ? `${view.activeIndex}:${view.steps[view.activeIndex].content}` : null
}
