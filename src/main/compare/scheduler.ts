/**
 * Planificador de arranques de una comparación. Puro: decide qué columna arranca ahora y cuándo volver a mirar.
 *
 * - Máximo `perProvider` sesiones a la vez por proveedor (2 en OpenCode Go y en Zen, 4 en el resto).
 * - Arranques escalonados `staggerMs` (global).
 * - Un proveedor en pausa por cuota no arranca nada, pero no bloquea a los demás.
 */
import type { CompareColumnState } from '@shared/ipc-code'
import { COMPARE_LIMITS } from './limits'

export interface SchedColumn {
  index: number
  providerID: string
  state: CompareColumnState
  /** Ocupa una plaza (arrancando, en curso o esperando su reintento por cuota). */
  holdsSlot: boolean
}

export interface SchedInput {
  columns: readonly SchedColumn[]
  now: number
  /** Epoch ms del último arranque (0 si no hubo ninguno). */
  lastStartAt: number
  paused: ReadonlySet<string>
  limits?: { perProvider: Readonly<Record<string, number>>; defaultPerProvider: number; staggerMs: number; maxColumns: number }
}

export interface SchedDecision {
  /** Columna que debe arrancar ya (como mucho una por llamada). */
  start: number | null
  /** Epoch ms al que volver a evaluar (por el escalonado); `null` = esperar a un cambio de estado. */
  wakeAt: number | null
}

export function providerLimit(
  providerID: string,
  limits: Pick<NonNullable<SchedInput['limits']>, 'perProvider' | 'defaultPerProvider'> = COMPARE_LIMITS
): number {
  return limits.perProvider[providerID] ?? limits.defaultPerProvider
}

export function pickNextStart(input: SchedInput): SchedDecision {
  const limits = input.limits ?? COMPARE_LIMITS
  const cols = input.columns.slice(0, limits.maxColumns)
  const active = new Map<string, number>()
  for (const c of cols) if (c.holdsSlot) active.set(c.providerID, (active.get(c.providerID) ?? 0) + 1)
  const candidate = cols
    .filter((c) => c.state === 'queued' && !c.holdsSlot && !input.paused.has(c.providerID))
    .sort((a, b) => a.index - b.index)
    .find((c) => (active.get(c.providerID) ?? 0) < providerLimit(c.providerID, limits))
  if (!candidate) return { start: null, wakeAt: null }
  const readyAt = input.lastStartAt > 0 ? input.lastStartAt + limits.staggerMs : 0
  if (input.now < readyAt) return { start: null, wakeAt: readyAt }
  return { start: candidate.index, wakeAt: null }
}
