/** Qué muestra el inicio de Tareas para retomar trabajo: lo que espera al usuario y lo reciente de la carpeta (lógica pura). */
import type { Session } from '@opencode-ai/sdk/v2/client'
import type { TaskStatus } from './util'

/** Estados en los que la tarea está parada esperando al usuario. */
const WAITING: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['waiting', 'question', 'plan_ready'])
/** Urgencia entre las que esperan: la pregunta primero, luego la aprobación, luego el plan. */
const WAIT_RANK: Partial<Record<TaskStatus, number>> = { question: 0, waiting: 1, plan_ready: 2 }
/** Sin interés para «Retomar»: una tarea nueva sin mensajes no hay qué retomar (las archivadas ya no llegan). */
const SKIP_RECENT: ReadonlySet<TaskStatus> = new Set<TaskStatus>(['archived', 'idle'])

export const HOME_WAITING_MAX = 3
export const HOME_RECENT_MAX = 5

export interface HomeFocusItem {
  task: Session
  status: TaskStatus
}

export interface HomeFocus {
  /** Las que esperan al usuario (máx. 3), la más urgente y reciente primero. */
  waiting: HomeFocusItem[]
  /** Cuántas esperan en total (puede ser más que las mostradas). */
  waitingTotal: number
  /** Las más recientes que no esperan al usuario (máx. 5). */
  recent: HomeFocusItem[]
  /** ¿La carpeta ya tiene tareas? Decide si las sugerencias salen plegadas. */
  hasTasks: boolean
}

/**
 * `tasks`: tareas de la carpeta actual (sin archivadas ni subtareas). Sin tareas (p. ej. sin carpeta) todo sale vacío:
 * nunca se inventa trabajo de otras carpetas. Una tarea no sale en las dos listas.
 */
export function pickHomeFocus(tasks: Session[], statusOf: (t: Session) => TaskStatus): HomeFocus {
  const items: HomeFocusItem[] = tasks.map((task) => ({ task, status: statusOf(task) }))
  const byRecent = (a: HomeFocusItem, b: HomeFocusItem): number =>
    b.task.time.updated - a.task.time.updated || a.task.id.localeCompare(b.task.id)
  const waitingAll = items
    .filter((i) => WAITING.has(i.status))
    .sort((a, b) => (WAIT_RANK[a.status] ?? 9) - (WAIT_RANK[b.status] ?? 9) || byRecent(a, b))
  const recent = items
    .filter((i) => !WAITING.has(i.status) && !SKIP_RECENT.has(i.status))
    .sort(byRecent)
    .slice(0, HOME_RECENT_MAX)
  return { waiting: waitingAll.slice(0, HOME_WAITING_MAX), waitingTotal: waitingAll.length, recent, hasTasks: items.length > 0 }
}
