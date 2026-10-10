/** Grupo de día de una sesión para la lista lateral: Hoy / Ayer / Esta semana / Antes. */
export type DayBucket = 'today' | 'yesterday' | 'week' | 'older'

const DAY = 86_400_000

export function dayBucket(ts: number, now = Date.now()): DayBucket {
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  const t0 = startOfToday.getTime()
  if (ts >= t0) return 'today'
  if (ts >= t0 - DAY) return 'yesterday'
  if (ts >= t0 - 6 * DAY) return 'week'
  return 'older'
}
