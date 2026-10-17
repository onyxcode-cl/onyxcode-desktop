/** Utilidades puras de programación (presets → cron, próxima ejecución, etiquetas). */
import { t, type MsgKey } from '@shared/i18n'
import { Cron } from 'croner'
import { WEEKDAYS_ES, type RoutineSchedule, type SchedulePreview } from '@shared/ipc-tasks'

const HOUR_MS = 3_600_000

function parseTime(time: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) throw new Error(t('merr.sched.badTime', { time }))
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) throw new Error(t('merr.sched.badTimeShort', { time }))
  return { h, m: min }
}

/** Cron equivalente, o null para intervalos (que se calculan desde la última ejecución). */
export function scheduleToCron(s: RoutineSchedule): string | null {
  switch (s.kind) {
    case 'daily': {
      const { h, m } = parseTime(s.time)
      return `${m} ${h} * * *`
    }
    case 'weekly': {
      const { h, m } = parseTime(s.time)
      if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6) throw new Error(t('merr.sched.badDay'))
      return `${m} ${h} * * ${s.day}`
    }
    case 'file':
      return null
    case 'interval':
      if (!Number.isFinite(s.hours) || s.hours <= 0 || s.hours > 24 * 31) throw new Error(t('merr.sched.badInterval'))
      return null
    case 'cron': {
      const expr = s.expr.trim()
      if (expr.split(/\s+/).length !== 5) throw new Error(t('merr.sched.badCronFields'))
      return expr
    }
  }
}

function cronNext(expr: string, from: Date): Date | null {
  const job = new Cron(expr, { paused: true, mode: '5-part' })
  try {
    return job.nextRun(from)
  } finally {
    job.stop()
  }
}

/** Valida la programación (lanza con mensaje en español si es inválida). */
export function validateSchedule(s: RoutineSchedule): void {
  if (s.kind === 'file') {
    if (!Number.isFinite(s.settleSec) || s.settleSec < 1 || s.settleSec > 120) throw new Error(t('merr.sched.fileSettle'))
    if (!Number.isFinite(s.maxPerHour) || s.maxPerHour < 1 || s.maxPerHour > 60) throw new Error(t('merr.sched.fileMax'))
    if (
      !Array.isArray(s.patterns) ||
      s.patterns.length > 10 ||
      s.patterns.some((p) => typeof p !== 'string' || p.length > 100 || /[\\/]/.test(p))
    ) {
      throw new Error(t('merr.sched.filePatterns'))
    }
    return
  }
  const cron = scheduleToCron(s)
  if (cron) {
    try {
      cronNext(cron, new Date())
    } catch (err) {
      throw new Error(t('merr.sched.badCron', { detail: err instanceof Error ? err.message : String(err) }))
    }
  }
}

/**
 * Próxima ejecución estrictamente posterior a `after` (epoch ms).
 * Para intervalos: `after + horas`.
 */
export function nextRunAfter(s: RoutineSchedule, after: number): number | null {
  if (s.kind === 'file') return null // sin reloj: lo dispara el vigilante de la carpeta
  const cron = scheduleToCron(s)
  if (!cron) return after + (s as { hours: number }).hours * HOUR_MS
  return cronNext(cron, new Date(after))?.getTime() ?? null
}

export function scheduleLabel(s: RoutineSchedule): string {
  switch (s.kind) {
    case 'daily':
      return t('merr.sched.daily', { time: s.time })
    case 'weekly':
      return t('merr.sched.weekly', { day: WEEKDAYS_ES[s.day] ? t(`merr.weekday.${s.day}` as MsgKey) : '?', time: s.time })
    case 'interval':
      return s.hours === 1 ? t('merr.sched.hourly') : t('merr.sched.everyHours', { hours: s.hours })
    case 'cron':
      return t('merr.sched.cron', { expr: s.expr })
    case 'file':
      return t('merr.sched.file', { folder: s.folder })
  }
}

export function previewSchedule(s: RoutineSchedule, count = 3): SchedulePreview {
  try {
    validateSchedule(s)
    const cron = scheduleToCron(s)
    const next: number[] = []
    let from = Date.now()
    for (let i = 0; i < count; i++) {
      const n = nextRunAfter(s, from)
      if (n == null) break
      next.push(n)
      from = n
    }
    return { valid: true, cron, next, label: scheduleLabel(s) }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err), cron: null, next: [], label: '' }
  }
}

/**
 * Ejecuciones que tocaban entre `basis` y `now` (la más reciente y cuántas hubo, con tope), para ofrecer UNA sola
 * recuperación sin acumular decenas. `null` = ninguna.
 */
export function missedRuns(s: RoutineSchedule, basis: number, now: number, cap = 500): { latest: number; count: number } | null {
  if (s.kind === 'file') return null
  let count = 0
  let latest = 0
  let from = basis
  for (let i = 0; i < cap; i++) {
    const n = nextRunAfter(s, from)
    if (n == null || n > now) break
    count++
    latest = n
    from = n
  }
  return count > 0 ? { latest, count } : null
}
