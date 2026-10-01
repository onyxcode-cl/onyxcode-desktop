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

/** Motivo por el que un cambio no se puede deshacer (panel «Cambios en archivos»). */
export function notRestorableText(reason: 'large' | 'cloud' | 'unreadable' | undefined): string {
  if (reason === 'cloud') return 'No restaurable (solo en la nube): el archivo estaba en iCloud sin descargar y no se guardó.'
  if (reason === 'unreadable') return 'No restaurable: el archivo no se pudo leer al guardar el punto.'
  return 'No se puede deshacer: el archivo pesa más de 50 MB y no se guardó.'
}

/** Aviso cuando el punto se guardó pero algunos archivos no entraron en él. */
export function notCopiedWarningText(count: number): string {
  return `El punto de restauración no incluye ${count} ${count === 1 ? 'archivo' : 'archivos'} (solo en la nube o ilegibles): si cambian, no se podrán deshacer.`
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
