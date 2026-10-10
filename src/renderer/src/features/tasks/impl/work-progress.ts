/** Avance de una tarea en curso, calculado de la conversación: qué está haciendo el agente y cuántos pasos del plan lleva. */
import type { ToolPart } from '@opencode-ai/sdk/v2/client'
import type { MessageEntry } from '../../../lib/session-reducer'
import { parseTodos } from '../../../lib/conversation/parts'

export interface WorkProgress {
  /** Herramienta que corre ahora mismo (null = el agente está pensando). */
  tool: ToolPart | null
  /** Pasos del plan completados y total (total 0 = no hay plan en pasos). */
  done: number
  total: number
  /** Cuándo empezó este turno (ms; null si no se sabe). */
  startedAt: number | null
}

export function workProgress(entries: MessageEntry[]): WorkProgress {
  let tool: ToolPart | null = null
  let done = 0
  let total = 0
  let startedAt: number | null = null
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!
    if (startedAt === null && e.info.role === 'user') startedAt = e.info.time.created
    for (let j = e.parts.length - 1; j >= 0; j--) {
      const p = e.parts[j]!
      if (p.type !== 'tool') continue
      if (!tool && (p.state.status === 'running' || p.state.status === 'pending') && p.tool !== 'todowrite') tool = p
      if (total === 0 && p.tool === 'todowrite') {
        const todos = parseTodos(p.state.input?.todos)
        if (todos && todos.length > 0) {
          total = todos.length
          done = todos.filter((t) => t.status === 'completed').length
        }
      }
    }
    if (startedAt !== null && tool && total > 0) break
  }
  return { tool, done, total, startedAt }
}

/** «1:05» / «0:08» para el reloj del turno. */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
