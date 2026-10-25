/**
 * Lógica pura de la tarjeta de compactación y de «Compactar hasta aquí» en la conversación de Code:
 * qué turno es una compactación, cuál es su resumen y desde qué mensajes se puede compactar.
 */
import type { CompactBlockReason } from '@shared/compaction'

interface PartLike {
  type: string
  text?: string
  synthetic?: boolean
  ignored?: boolean
}
interface MsgLike {
  info: { id: string; role: string; summary?: unknown }
  parts: readonly PartLike[]
}

/** La parte `compaction` de un mensaje de la persona (el motor crea uno por cada compactación). */
export function compactionPartOf<P extends PartLike>(parts: readonly P[] | undefined): P | undefined {
  return parts?.find((p) => p.type === 'compaction')
}

/**
 * Separa las respuestas de un turno de compactación: el resumen (mensaje marcado `summary`; si ningún motor lo marca, la primera
 * respuesta) y el resto, que se pinta como siempre (p. ej. la respuesta que continúa tras compactar solo).
 */
export function splitCompactionTurn<M extends MsgLike>(assistant: readonly M[]): { summary: M[]; rest: M[] } {
  const flagged = assistant.filter((m) => m.info.role === 'assistant' && m.info.summary === true)
  const summary = flagged.length > 0 ? flagged : assistant.slice(0, 1)
  const ids = new Set(summary.map((m) => m.info.id))
  return { summary: [...summary], rest: assistant.filter((m) => !ids.has(m.info.id)) }
}

/** Texto del resumen (sin partes sintéticas ni ignoradas). */
export function summaryTextOf(summary: readonly MsgLike[]): string {
  return summary
    .flatMap((m) => m.parts)
    .filter((p) => p.type === 'text' && !p.synthetic && !p.ignored && !!p.text)
    .map((p) => p.text as string)
    .join('\n\n')
    .trim()
}

/**
 * Qué turnos admiten «Compactar hasta aquí»: los que empiezan con un mensaje real de la persona (no una compactación ni un aviso
 * sintético) POSTERIOR a la última compactación y que no son el primer mensaje de la conversación (no habría nada que resumir antes).
 * `isReal(user)` dice si el mensaje es una entrada de la persona con contenido.
 */
export function compactableTurns<U extends MsgLike>(turns: readonly { user: U | null }[], isReal: (user: U) => boolean): boolean[] {
  let lastCompaction = -1
  let firstReal = -1
  turns.forEach((turn, i) => {
    if (!turn.user) return
    if (compactionPartOf(turn.user.parts)) lastCompaction = i
    else if (firstReal < 0 && isReal(turn.user)) firstReal = i
  })
  return turns.map(
    (turn, i) => !!turn.user && !compactionPartOf(turn.user.parts) && isReal(turn.user) && i > lastCompaction && i > firstReal
  )
}

/** Texto visible para el motivo por el que «Compactar hasta aquí» está deshabilitado. */
export const COMPACT_BLOCK_KEY = {
  ocupada: 'code.compaction.upTo.blocked.ocupada',
  pendiente: 'code.compaction.upTo.blocked.pendiente',
  revert: 'code.compaction.upTo.blocked.revert'
} as const satisfies Record<CompactBlockReason, string>
