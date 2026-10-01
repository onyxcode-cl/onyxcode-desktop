/**
 * Lógica pura de los puntos de restauración en la interfaz de Tareas: qué punto corresponde a un
 * mensaje o a toda la tarea, y los textos de los avisos.
 */
import type { TasksRestorePoint } from '@shared/ipc-tasks'

/** Etiqueta del punto que se crea justo antes de deshacer (así deshacer se puede deshacer). */
export const UNDO_POINT_LABEL = 'Antes de deshacer'

/** Resultado de deshacer/rehacer, tal como lo muestra el aviso de la conversación. */
export interface RestoreResult {
  taskId: string
  kind: 'undone' | 'redone'
  restored: number
  trashed: number
  failed: Array<{ path: string; reason: string }>
  /** Punto «Antes de deshacer»: lo que usa «Rehacer». */
  undoPointId: string
  /** Si el deshacer también ocultó mensajes (`session.revert`), «Rehacer» los recupera. */
  revertedMessageId?: string
}

const usable = (p: TasksRestorePoint): boolean => p.status === 'ok' && p.label !== UNDO_POINT_LABEL

/** Punto del turno de un mensaje: el último guardado con `createdAt` ≤ momento del mensaje. */
export function pickPointForMessage(points: TasksRestorePoint[], messageCreatedAt: number): TasksRestorePoint | null {
  let best: TasksRestorePoint | null = null
  for (const p of points) {
    if (!usable(p) || p.createdAt > messageCreatedAt) continue
    if (!best || p.createdAt >= best.createdAt) best = p
  }
  return best
}

/** Punto más antiguo de la tarea: cómo estaba la carpeta antes de que empezara. */
export function firstPoint(points: TasksRestorePoint[]): TasksRestorePoint | null {
  let best: TasksRestorePoint | null = null
  for (const p of points) {
    if (!usable(p)) continue
    if (!best || p.createdAt < best.createdAt) best = p
  }
  return best
}

export function restoreWarningText(reason: string): string {
  return `Esta vez no se guardó un punto de restauración: ${reason}`
}

export function restoreResultText(r: Pick<RestoreResult, 'kind' | 'restored' | 'trashed'>): string {
  return `${r.kind === 'undone' ? 'Cambios deshechos' : 'Cambios rehechos'}: ${r.restored} restaurados, ${r.trashed} enviados a la Papelera.`
}

/** Resumen corto de los archivos que no se pudieron restaurar (hasta 3). */
export function failedText(failed: Array<{ path: string; reason: string }>): string {
  if (failed.length === 0) return ''
  const shown = failed
    .slice(0, 3)
    .map((f) => `${f.path} (${f.reason})`)
    .join('; ')
  return `No se pudo restaurar: ${shown}${failed.length > 3 ? ` y ${failed.length - 3} más` : ''}.`
}
