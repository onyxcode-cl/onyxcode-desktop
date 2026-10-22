/**
 * Marca que el vigilante del Modo código deja en la conversación cuando aborta un programa `execute` por pasar un tope.
 *
 * El motor aborta con un `MessageAbortedError` genérico y la conversación diría «Detenido por el usuario», que sería falso.
 * `main` escribe en el mensaje abortado una parte de texto `synthetic` (los tres modos ya las ocultan) con esta marca en
 * `metadata`; el renderer la lee para explicar la causa real. Viaja por el propio motor: no hay canal IPC nuevo.
 */
export const WATCHDOG_MARK_KEY = 'lazunoxWatchdog'

export type WatchdogMarkLimit = 'time' | 'calls' | 'output'

export interface WatchdogMark {
  limit: WatchdogMarkLimit
  /** Segundos (`time`), número de llamadas (`calls`) o KB (`output`) del tope que se pasó. */
  value: number
}

export function buildWatchdogMark(mark: WatchdogMark): Record<string, unknown> {
  return { [WATCHDOG_MARK_KEY]: { limit: mark.limit, value: mark.value } }
}

/** Busca la marca en las partes de un mensaje; `null` si no hay (aborto de la persona o error cualquiera). */
export function readWatchdogMark(parts: ReadonlyArray<unknown> | undefined): WatchdogMark | null {
  for (const p of parts ?? []) {
    if (!p || typeof p !== 'object') continue
    const meta = (p as { metadata?: unknown }).metadata
    if (!meta || typeof meta !== 'object') continue
    const m = (meta as Record<string, unknown>)[WATCHDOG_MARK_KEY]
    if (!m || typeof m !== 'object') continue
    const { limit, value } = m as { limit?: unknown; value?: unknown }
    if ((limit === 'time' || limit === 'calls' || limit === 'output') && typeof value === 'number' && Number.isFinite(value))
      return { limit, value }
  }
  return null
}
