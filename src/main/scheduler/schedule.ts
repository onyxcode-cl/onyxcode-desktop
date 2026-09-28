/** Utilidades puras de programación (presets → cron, próxima ejecución, etiquetas). */
import { Cron } from 'croner'
import { WEEKDAYS_ES, type RoutineSchedule, type SchedulePreview } from '@shared/ipc-cowork'

const HOUR_MS = 3_600_000

function parseTime(time: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim())
  if (!m) throw new Error(`Hora inválida "${time}" (usa HH:MM)`)
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) throw new Error(`Hora inválida "${time}"`)
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
      if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6) throw new Error('Día de la semana inválido')
      return `${m} ${h} * * ${s.day}`
    }
    case 'interval':
      if (!Number.isFinite(s.hours) || s.hours <= 0 || s.hours > 24 * 31) throw new Error('Intervalo inválido (horas > 0)')
      return null
    case 'cron': {
      const expr = s.expr.trim()
      if (expr.split(/\s+/).length !== 5) throw new Error('La expresión cron debe tener 5 campos (min hora día mes díaSemana)')
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
  const cron = scheduleToCron(s)
  if (cron) {
    try {
      cronNext(cron, new Date())
    } catch (err) {
      throw new Error(`Cron inválido: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/**
 * Próxima ejecución estrictamente posterior a `after` (epoch ms).
 * Para intervalos: `after + horas`.
 */
export function nextRunAfter(s: RoutineSchedule, after: number): number | null {
  const cron = scheduleToCron(s)
  if (!cron) return after + (s as { hours: number }).hours * HOUR_MS
  return cronNext(cron, new Date(after))?.getTime() ?? null
}

export function scheduleLabel(s: RoutineSchedule): string {
  switch (s.kind) {
    case 'daily':
      return `Todos los días a las ${s.time}`
    case 'weekly':
      return `Cada ${WEEKDAYS_ES[s.day] ?? '?'} a las ${s.time}`
    case 'interval':
      return s.hours === 1 ? 'Cada hora' : `Cada ${s.hours} horas`
    case 'cron':
      return `Cron: ${s.expr}`
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
