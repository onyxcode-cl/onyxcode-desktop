/** Utilidades de programación para la UI de Rutinas: textos en español, presets y cuenta atrás. */
import { WEEKDAYS_ES, type RoutineSchedule } from '@shared/ipc-cowork'

const MONTHS_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const DOW_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function listEs(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

/** Expande un campo cron simple (números, rangos, listas; sin pasos) a valores. null si no se puede. */
function expandField(field: string, min: number, max: number, names?: Record<string, number>): number[] | null {
  if (field === '*') return null
  const out = new Set<number>()
  for (const raw of field.split(',')) {
    const part = raw.trim().toLowerCase()
    const val = (x: string): number => (names && x in names ? names[x] : Number(x))
    const m = /^([a-z0-9]+)(?:-([a-z0-9]+))?$/.exec(part)
    if (!m) return null
    const a = val(m[1])
    const b = m[2] !== undefined ? val(m[2]) : a
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < min || b > max || a > b) return null
    for (let i = a; i <= b; i++) out.add(i)
  }
  return [...out].sort((x, y) => x - y)
}

/** Días de la semana (0 = domingo) → texto: "de lunes a viernes", "los sábados y domingos", "cada martes". */
export function weekdaysText(days: number[]): string {
  const set = [...new Set(days.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b)
  if (set.length === 7) return 'todos los días'
  if (set.join() === '1,2,3,4,5') return 'de lunes a viernes'
  if (set.join() === '0,6') return 'los fines de semana'
  if (set.length === 1) return `cada ${WEEKDAYS_ES[set[0]]}`
  // Orden natural empezando en lunes.
  const ordered = [...set.filter((d) => d !== 0), ...set.filter((d) => d === 0)]
  const plural = (d: number): string => (d === 0 || d === 6 ? `${WEEKDAYS_ES[d]}s` : WEEKDAYS_ES[d])
  return `los ${listEs(ordered.map(plural))}`
}

/** Traduce una expresión cron de 5 campos a español. null si no es un patrón reconocible. */
export function describeCron(expr: string): string | null {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return null
  const [min, hour, dom, mon, dow] = f

  // ── Parte horaria
  let time: string | null = null
  let everyHourish = false
  const mins = expandField(min, 0, 59)
  const hours = expandField(hour, 0, 23)
  const stepMin = /^\*\/(\d+)$/.exec(min)
  const stepHour = /^\*\/(\d+)$/.exec(hour)
  if (min === '*' && hour === '*') {
    time = 'cada minuto'
    everyHourish = true
  } else if (stepMin && hour === '*') {
    time = `cada ${stepMin[1]} minutos`
    everyHourish = true
  } else if (stepMin && hours) {
    time = `cada ${stepMin[1]} minutos entre las ${hours[0]}:00 y las ${hours[hours.length - 1]}:59`
  } else if (mins && mins.length === 1 && hour === '*') {
    time = mins[0] === 0 ? 'cada hora en punto' : `cada hora, al minuto ${mins[0]}`
    everyHourish = true
  } else if (mins && mins.length === 1 && stepHour) {
    time = `cada ${stepHour[1]} horas${mins[0] ? ` (minuto ${mins[0]})` : ''}`
    everyHourish = true
  } else if (mins && mins.length === 1 && hours) {
    const contiguous = hours.length > 2 && hours[hours.length - 1] - hours[0] === hours.length - 1
    if (contiguous) time = `cada hora de ${hours[0]}:${pad(mins[0])} a ${hours[hours.length - 1]}:${pad(mins[0])}`
    else time = `a las ${listEs(hours.map((h) => `${h}:${pad(mins[0])}`))}`
  } else if (mins && hours && hours.length === 1) {
    time = `a las ${listEs(mins.map((m) => `${hours[0]}:${pad(m)}`))}`
  }
  if (!time) return null

  // ── Parte de días
  let days: string | null = null
  const doms = expandField(dom, 1, 31)
  const mons = expandField(mon, 1, 12)
  const dows = expandField(dow, 0, 7, DOW_NAMES)
  if (dom !== '*' && !doms) return null
  if (mon !== '*' && !mons) return null
  if (dow !== '*' && !dows) return null
  if (!doms && !mons && !dows) days = everyHourish ? '' : 'todos los días'
  else if (dows && !doms) days = weekdaysText(dows)
  else if (doms && !dows) days = doms.length === 1 ? `el día ${doms[0]} de cada mes` : `los días ${listEs(doms.map(String))} de cada mes`
  else if (!doms && !dows) days = ''
  else days = null
  if (days === null) return null
  if (mons && doms && !dows) {
    days = `el ${listEs(doms.map(String))} de ${listEs(mons.map((m) => MONTHS_ES[m - 1]))}`
  } else if (mons) {
    const monText = `en ${listEs(mons.map((m) => MONTHS_ES[m - 1]))}`
    days = days ? `${days} ${monText}` : monText
    if (!doms && !dows && !everyHourish) days = `todos los días ${monText}`
  }
  const sep = time.startsWith('a las') || time.startsWith('cada hora de') ? ' ' : ', '
  return capitalize(days ? `${days}${sep}${time}` : time)
}

/** Descripción corta y legible de cualquier programación. */
export function scheduleText(s: RoutineSchedule): string {
  switch (s.kind) {
    case 'daily':
      return `Todos los días a las ${s.time}`
    case 'weekly':
      return `Cada ${WEEKDAYS_ES[s.day] ?? '?'} a las ${s.time}`
    case 'interval':
      return s.hours === 1 ? 'Cada hora' : `Cada ${s.hours} horas`
    case 'cron':
      return describeCron(s.expr) ?? `Cron ${s.expr}`
  }
}

// ---------------------------------------------------------------------------
// Constructor "días + hora"
// ---------------------------------------------------------------------------

export interface DaysSpec {
  days: number[]
  time: string
}

/** Si la programación es "ciertos días a una hora", la descompone. */
export function toDaysSpec(s: RoutineSchedule): DaysSpec | null {
  if (s.kind === 'daily') return { days: [0, 1, 2, 3, 4, 5, 6], time: s.time }
  if (s.kind === 'weekly') return { days: [s.day], time: s.time }
  if (s.kind === 'cron') {
    const m = /^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-7,\-*]+)$/.exec(s.expr.trim())
    if (!m) return null
    const days = m[3] === '*' ? [0, 1, 2, 3, 4, 5, 6] : expandField(m[3], 0, 7)
    if (!days || Number(m[2]) > 23 || Number(m[1]) > 59) return null
    return { days: [...new Set(days.map((d) => (d === 7 ? 0 : d)))], time: `${pad(Number(m[2]))}:${pad(Number(m[1]))}` }
  }
  return null
}

function compressDays(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j - i >= 2 ? `${sorted[i]}-${sorted[j]}` : sorted.slice(i, j + 1).join(','))
    i = j + 1
  }
  return parts.join(',')
}

/** Construye la programación más simple equivalente a "estos días a esta hora". */
export function fromDaysSpec(spec: DaysSpec): RoutineSchedule {
  const days = [...new Set(spec.days)].sort((a, b) => a - b)
  if (days.length === 7 || days.length === 0) return { kind: 'daily', time: spec.time }
  if (days.length === 1) return { kind: 'weekly', day: days[0], time: spec.time }
  const [h, m] = spec.time.split(':').map(Number)
  return { kind: 'cron', expr: `${m || 0} ${h || 0} * * ${compressDays(days)}` }
}

export function sameSchedule(a: RoutineSchedule, b: RoutineSchedule): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export interface SchedulePreset {
  id: string
  label: string
  schedule: RoutineSchedule
}

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  { id: 'morning', label: 'Cada mañana 8:00', schedule: { kind: 'daily', time: '08:00' } },
  { id: 'weekdays', label: 'Lunes a viernes', schedule: { kind: 'cron', expr: '0 9 * * 1-5' } },
  { id: 'hourly', label: 'Cada hora', schedule: { kind: 'interval', hours: 1 } },
  { id: 'weekly', label: 'Semanal', schedule: { kind: 'weekly', day: 1, time: '09:00' } }
]

// ---------------------------------------------------------------------------
// Fechas relativas
// ---------------------------------------------------------------------------

/** "en 5 min", "en 2 h 10 min", "mañana 08:00", "lun 12 may 09:00". */
export function untilText(ts: number, now = Date.now()): string {
  const diff = ts - now
  if (diff <= 30_000) return 'en instantes'
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return `en ${mins} min`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 12) return m ? `en ${h} h ${m} min` : `en ${h} h`
  const d = new Date(ts)
  const today = new Date(now)
  const tomorrow = new Date(now + 86_400_000)
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === today.toDateString()) return `hoy ${hhmm}`
  if (d.toDateString() === tomorrow.toDateString()) return `mañana ${hhmm}`
  if (diff < 6 * 86_400_000) return `${WEEKDAYS_ES[d.getDay()]} ${hhmm}`
  return d.toLocaleString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function agoText(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return 'hace un momento'
  const m = Math.round(s / 60)
  if (m < 60) return `hace ${m} min`
  const h = Math.round(m / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.round(h / 24)
  if (d === 1) return 'ayer'
  if (d < 7) return `hace ${d} días`
  return new Date(ts).toLocaleDateString('es-CL', { day: 'numeric', month: 'short' })
}

export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${pad(s % 60)} s`
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`
}

export function fullDate(ts: number): string {
  return new Date(ts).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
