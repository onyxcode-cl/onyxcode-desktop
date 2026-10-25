/**
 * Lógica pura de «Cambios de este turno» y del diálogo de rebobinar (sin React ni store): mezcla estable de la lista de turnos y
 * el aviso que queda después de rebobinar o deshacer. El contrato y los parseadores viven en `@shared/rewind`.
 */
import type { RewindMode, RewindResult, RewindSkipped, TurnSummary, UndoRewindResult } from '@shared/rewind'

/** Aviso tras rebobinar (`done`) o deshacer (`undone`). Solo cifras y rutas en texto plano. */
export interface RewindNotice {
  kind: 'done' | 'undone'
  modo?: RewindMode
  restaurados: number
  borrados: number
  mensajesOcultos: number
  omitidos: RewindSkipped[]
  /** Solo `done`: el motor dice que se puede deshacer (se ofrece «Deshacer»). */
  puedeDeshacer: boolean
}

export function noticeFromResult(r: RewindResult): RewindNotice {
  return {
    kind: 'done',
    modo: r.modo,
    restaurados: r.restaurados.length,
    borrados: r.borrados.length,
    mensajesOcultos: r.mensajesOcultos,
    omitidos: r.omitidos,
    puedeDeshacer: r.puedeDeshacer
  }
}

export function noticeFromUndo(r: UndoRewindResult): RewindNotice {
  // Un conflicto al deshacer es un archivo que no se tocó: se cuenta como omitido aunque el motor no lo repita en `omitidos`.
  const known = new Set(r.omitidos.map((o) => o.file))
  const omitidos = [...r.omitidos, ...r.conflictos.filter((f) => !known.has(f)).map((file) => ({ file, motivo: 'conflicto' }))]
  return {
    kind: 'undone',
    restaurados: r.restaurados.length,
    borrados: r.borrados.length,
    mensajesOcultos: 0,
    omitidos,
    puedeDeshacer: false
  }
}

const sameFiles = (a: TurnSummary['files'], b: TurnSummary['files']): boolean =>
  a.length === b.length &&
  a.every((f, i) => {
    const g = b[i]
    return f.file === g.file && f.status === g.status && f.additions === g.additions && f.deletions === g.deletions && f.origen === g.origen
  })

const sameTurn = (a: TurnSummary, b: TurnSummary): boolean =>
  a.messageID === b.messageID &&
  a.time === b.time &&
  a.truncated === b.truncated &&
  a.restaurable === b.restaurable &&
  a.motivo === b.motivo &&
  sameFiles(a.files, b.files)

/**
 * Lista nueva reutilizando los objetos que no cambiaron: así los turnos ya pintados (memoizados) no se vuelven a pintar en cada
 * recarga. Devuelve `prev` tal cual si nada cambió.
 */
export function mergeTurns(prev: readonly TurnSummary[] | undefined, next: readonly TurnSummary[]): readonly TurnSummary[] {
  if (!prev) return next
  const old = new Map(prev.map((t) => [t.messageID, t]))
  const merged = next.map((t) => {
    const was = old.get(t.messageID)
    return was && sameTurn(was, t) ? was : t
  })
  return merged.length === prev.length && merged.every((t, i) => t === prev[i]) ? prev : merged
}

/** Turnos por id del mensaje de la persona, solo los que cambiaron archivos. */
export function turnsWithChanges(turns: readonly TurnSummary[] | undefined): Map<string, TurnSummary> {
  const out = new Map<string, TurnSummary>()
  for (const t of turns ?? []) if (t.files.length > 0) out.set(t.messageID, t)
  return out
}
