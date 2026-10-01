/**
 * Lógica pura de los puntos de restauración en la interfaz de Tareas: qué punto corresponde a un
 * mensaje o a toda la tarea, y los textos de los avisos.
 */
import { t } from '@shared/i18n'
import type { TasksRestorePoint } from '@shared/ipc-tasks'

/** Etiqueta del punto que se crea justo antes de deshacer (así deshacer se puede deshacer). Se guarda en disco y se compara: no se traduce. */
// i18n-ignore: identificador persistido en el manifiesto
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
  if (reason === 'cloud') return t('tasks.restore.notRestorable.cloud')
  if (reason === 'unreadable') return t('tasks.restore.notRestorable.unreadable')
  return t('tasks.restore.notRestorable.large')
}

/** Aviso cuando el punto se guardó pero algunos archivos no entraron en él. */
export function notCopiedWarningText(count: number): string {
  return t('tasks.restore.notCopied', { count })
}

export function restoreWarningText(reason: string): string {
  return t('tasks.restore.warning', { reason })
}

export function restoreResultText(r: Pick<RestoreResult, 'kind' | 'restored' | 'trashed'>): string {
  return t(r.kind === 'undone' ? 'tasks.restore.undone' : 'tasks.restore.redone', { restored: r.restored, trashed: r.trashed })
}

/** Resumen corto de los archivos que no se pudieron restaurar (hasta 3). */
export function failedText(failed: Array<{ path: string; reason: string }>): string {
  if (failed.length === 0) return ''
  const shown = failed
    .slice(0, 3)
    .map((f) => `${f.path} (${f.reason})`)
    .join('; ')
  return t('tasks.restore.failed', { shown, more: failed.length > 3 ? t('tasks.restore.failedMore', { n: failed.length - 3 }) : '' })
}
