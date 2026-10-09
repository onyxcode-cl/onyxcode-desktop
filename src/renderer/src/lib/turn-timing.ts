/**
 * Tiempos de un turno de conversación (inicio/fin, formateo de duración). Puro, sin dependencias de
 * Tareas ni de React: lo usa Tareas (`features/tasks/impl/util.ts`, re-exportado desde acá para no
 * romper nada) y el HUD de progreso de Chat (`features/chat/useChatProgress.ts`).
 */
import type { MessageEntry } from './session-reducer'

/** "0:42", "12:05", "1:02:10". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Inicio y fin del último turno (desde el último mensaje del usuario). */
export function turnTiming(entries: MessageEntry[]): { start: number | null; end: number | null } {
  let start: number | null = null
  let end: number | null = null
  for (let i = entries.length - 1; i >= 0; i--) {
    const info = entries[i].info
    if (info.role === 'assistant' && end === null && info.time.completed) end = info.time.completed
    if (info.role === 'user') {
      start = info.time.created
      break
    }
  }
  return { start, end }
}
