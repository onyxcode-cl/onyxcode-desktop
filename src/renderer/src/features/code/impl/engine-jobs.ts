/**
 * Vista PURA de los trabajos del motor propio (comandos y Code Mode) para el panel «Trabajos en segundo plano».
 * Los ayudantes (subagentes) los calcula `background-jobs.ts`; esto es lo que el motor informa por `jobs:list`.
 */
import type { EngineJob, EngineJobKind, EngineJobState } from '@shared/engine-jobs'

/** Cuánto tiempo (ms) se deja a la vista un trabajo del motor ya terminado (incluye «perdido» tras un reinicio, que conviene leer). */
export const ENGINE_FINISHED_GRACE_MS = 5 * 60_000
/** Máximo de filas ya terminadas que se muestran a la vez. */
export const MAX_FINISHED_ENGINE_JOBS = 5
/** Cada cuánto se pregunta al motor mientras haya algo en curso o el panel esté a la vista. */
export const ENGINE_JOBS_POLL_MS = 4000

export interface EngineJobRow {
  id: string
  kind: EngineJobKind
  title: string
  state: EngineJobState
  code: number | null
  startedAt: number
  endedAt: number | null
  elapsedMs: number
  /** Sigue en curso (se puede parar). */
  live: boolean
  /** Ayudante de fondo perdido tras un reinicio del motor: se puede reanudar. */
  resumable: boolean
}

export function selectEngineJobs(jobs: readonly EngineJob[], now: number): EngineJobRow[] {
  const live: EngineJobRow[] = []
  const finished: EngineJobRow[] = []
  for (const j of jobs) {
    // Ayudantes de fondo: los vivos ya salen en la lista de ayudantes de la app (con «Cancelar»); aquí solo los PERDIDOS tras un
    // reinicio del motor, que se quedan a la vista (la lápida dura 24 h) con «Reanudar», sin el plazo de gracia de los demás.
    if (j.kind === 'ayudante' && j.state !== 'perdido') continue
    const isLive = j.state === 'en_curso'
    const endedAt = isLive ? null : (j.endedAt ?? j.startedAt)
    const row: EngineJobRow = {
      id: j.id,
      kind: j.kind,
      title: j.title || j.id,
      state: j.state,
      code: j.code,
      startedAt: j.startedAt,
      endedAt,
      elapsedMs: Math.max(0, (endedAt ?? now) - j.startedAt),
      live: isLive,
      resumable: j.kind === 'ayudante' && j.state === 'perdido'
    }
    if (isLive || row.resumable) live.push(row)
    else if (endedAt !== null && now - endedAt <= ENGINE_FINISHED_GRACE_MS) finished.push(row)
  }
  live.sort((a, b) => a.startedAt - b.startedAt) // vivos y ayudantes por reanudar
  // De los terminados, los más recientes; luego se ordenan como el resto (por inicio).
  finished.sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
  const shown = finished.slice(0, MAX_FINISHED_ENGINE_JOBS).sort((a, b) => a.startedAt - b.startedAt)
  return [...live, ...shown]
}
