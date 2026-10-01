/** Utilidades de programación para la UI de Rutinas: textos en el idioma activo, presets y cuenta atrás. */
import type { RoutineSchedule } from '@shared/ipc-tasks'
import { getLang, t } from '@shared/i18n'
import { dateLocale } from '../../../lib/i18n'

/** Nombre del día (0 = domingo) en el idioma activo. */
function dayName(d: number): string {
  return t(`routines.weekday.${d}` as 'routines.weekday.0')
}
function dayNamePlural(d: number): string {
  return t(`routines.weekdayPlural.${d}` as 'routines.weekdayPlural.0')
}
function monthName(m: number): string {
  return t(`routines.month.${m}` as 'routines.month.1')
}

/** Hora h:mm: en español sin cero a la izquierda en la hora; en inglés, formato de 12 horas. */
function fmtHM(h: number, m: number): string {
  if (getLang() !== 'en') return `${h}:${pad(m)}`
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`
}

/** Hora «HH:MM» tal cual (español) o en formato de 12 horas (inglés). */
function fmtTime(time: string): string {
  if (getLang() !== 'en') return time
  const [h, m] = time.split(':').map(Number)
  return Number.isFinite(h) && Number.isFinite(m) ? fmtHM(h, m) : time
}

/** Día del mes: número (español) u ordinal (inglés: 1st, 2nd…). */
function dayOfMonth(n: number): string {
  if (getLang() !== 'en') return String(n)
  const v = n % 100
  const suffix = v >= 11 && v <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th')
  return `${n}${suffix}`
}
const DOW_NAMES: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function listEs(items: string[]): string {
  if (items.length <= 1) return items.join('')
  const and = t(items.length === 2 ? 'routines.sched.and2' : 'routines.sched.andN')
  return `${items.slice(0, -1).join(', ')}${and}${items[items.length - 1]}`
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

/** Días de la semana (0 = domingo) → texto: "de lunes a viernes", "los sábados y domingos", "cada martes" (o su equivalente en inglés). */
export function weekdaysText(days: number[]): string {
  const set = [...new Set(days.map((d) => (d === 7 ? 0 : d)))].sort((a, b) => a - b)
  if (set.length === 7) return t('routines.sched.everyDay')
  if (set.join() === '1,2,3,4,5') return t('routines.sched.weekdays')
  if (set.join() === '0,6') return t('routines.sched.weekend')
  if (set.length === 1) return t('routines.sched.everyWeekday', { day: dayName(set[0]) })
  // Orden natural empezando en lunes.
  const ordered = [...set.filter((d) => d !== 0), ...set.filter((d) => d === 0)]
  return t('routines.sched.onDays', { list: listEs(ordered.map(dayNamePlural)) })
}

/** Traduce una expresión cron de 5 campos al idioma activo. null si no es un patrón reconocible. */
export function describeCron(expr: string): string | null {
  const f = expr.trim().split(/\s+/)
  if (f.length !== 5) return null
  const [min, hour, dom, mon, dow] = f

  // ── Parte horaria
  let time: string | null = null
  let everyHourish = false
  let spaceSep = false
  const mins = expandField(min, 0, 59)
  const hours = expandField(hour, 0, 23)
  const stepMin = /^\*\/(\d+)$/.exec(min)
  const stepHour = /^\*\/(\d+)$/.exec(hour)
  if (min === '*' && hour === '*') {
    time = t('routines.sched.everyMinute')
    everyHourish = true
  } else if (stepMin && hour === '*') {
    time = t('routines.sched.everyNMin', { n: stepMin[1] })
    everyHourish = true
  } else if (stepMin && hours) {
    time = t('routines.sched.everyNMinBetween', { n: stepMin[1], from: fmtHM(hours[0], 0), to: fmtHM(hours[hours.length - 1], 59) })
  } else if (mins && mins.length === 1 && hour === '*') {
    time = mins[0] === 0 ? t('routines.sched.hourOnTheHour') : t('routines.sched.hourAtMinute', { m: mins[0] })
    everyHourish = true
  } else if (mins && mins.length === 1 && stepHour) {
    time = t('routines.sched.everyNHours', { n: stepHour[1] }) + (mins[0] ? t('routines.sched.atMinute', { m: mins[0] }) : '')
    everyHourish = true
  } else if (mins && mins.length === 1 && hours) {
    const contiguous = hours.length > 2 && hours[hours.length - 1] - hours[0] === hours.length - 1
    spaceSep = true
    if (contiguous) time = t('routines.sched.hourlyRange', { from: fmtHM(hours[0], mins[0]), to: fmtHM(hours[hours.length - 1], mins[0]) })
    else time = t('routines.sched.at', { list: listEs(hours.map((h) => fmtHM(h, mins[0]))) })
  } else if (mins && hours && hours.length === 1) {
    spaceSep = true
    time = t('routines.sched.at', { list: listEs(mins.map((m) => fmtHM(hours[0], m))) })
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
  if (!doms && !mons && !dows) days = everyHourish ? '' : t('routines.sched.everyDay')
  else if (dows && !doms) days = weekdaysText(dows)
  else if (doms && !dows)
    days =
      doms.length === 1
        ? t('routines.sched.monthDay', { day: dayOfMonth(doms[0]) })
        : t('routines.sched.monthDays', { list: listEs(doms.map(dayOfMonth)) })
  else if (!doms && !dows) days = ''
  else days = null
  if (days === null) return null
  if (mons && doms && !dows) {
    days = t('routines.sched.dayOfMonths', { days: listEs(doms.map(dayOfMonth)), months: listEs(mons.map(monthName)) })
  } else if (mons) {
    const monText = t('routines.sched.inMonths', { months: listEs(mons.map(monthName)) })
    days = days ? `${days} ${monText}` : monText
    if (!doms && !dows && !everyHourish) days = t('routines.sched.everyDayIn', { monText })
  }
  const sep = spaceSep ? ' ' : ', '
  return capitalize(days ? `${days}${sep}${time}` : time)
}

/** Descripción corta y legible de cualquier programación. */
export function scheduleText(s: RoutineSchedule): string {
  switch (s.kind) {
    case 'daily':
      return t('routines.sched.daily', { time: fmtTime(s.time) })
    case 'weekly':
      return t('routines.sched.weekly', { day: s.day >= 0 && s.day <= 6 ? dayName(s.day) : '?', time: fmtTime(s.time) })
    case 'interval':
      return s.hours === 1 ? t('routines.sched.everyHour') : t('routines.sched.everyNHoursCap', { n: s.hours })
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
  {
    id: 'morning',
    get label() {
      return t('routines.sched.preset.morning')
    },
    schedule: { kind: 'daily', time: '08:00' }
  },
  {
    id: 'weekdays',
    get label() {
      return t('routines.sched.preset.weekdays')
    },
    schedule: { kind: 'cron', expr: '0 9 * * 1-5' }
  },
  {
    id: 'hourly',
    get label() {
      return t('routines.sched.preset.hourly')
    },
    schedule: { kind: 'interval', hours: 1 }
  },
  {
    id: 'weekly',
    get label() {
      return t('routines.sched.preset.weekly')
    },
    schedule: { kind: 'weekly', day: 1, time: '09:00' }
  }
]

// ---------------------------------------------------------------------------
// Fechas relativas
// ---------------------------------------------------------------------------

/** "en 5 min", "en 2 h 10 min", "mañana 08:00", "lun 12 may 09:00" (o su equivalente en inglés). */
export function untilText(ts: number, now = Date.now()): string {
  const diff = ts - now
  if (diff <= 30_000) return t('routines.time.instant')
  const mins = Math.round(diff / 60_000)
  if (mins < 60) return t('routines.time.inMin', { n: mins })
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h < 12) return m ? t('routines.time.inHMin', { h, m }) : t('routines.time.inH', { h })
  const d = new Date(ts)
  const today = new Date(now)
  const tomorrow = new Date(now + 86_400_000)
  const hhmm = getLang() === 'en' ? fmtHM(d.getHours(), d.getMinutes()) : `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.toDateString() === today.toDateString()) return t('routines.time.today', { time: hhmm })
  if (d.toDateString() === tomorrow.toDateString()) return t('routines.time.tomorrow', { time: hhmm })
  if (diff < 6 * 86_400_000) return `${dayName(d.getDay())} ${hhmm}`
  return d.toLocaleString(dateLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function agoText(ts: number, now = Date.now()): string {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return t('routines.time.agoNow')
  const m = Math.round(s / 60)
  if (m < 60) return t('routines.time.agoMin', { n: m })
  const h = Math.round(m / 60)
  if (h < 24) return t('routines.time.agoH', { n: h })
  const d = Math.round(h / 24)
  if (d === 1) return t('routines.time.yesterday')
  if (d < 7) return t('routines.time.agoDays', { n: d })
  return new Date(ts).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
}

export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ${pad(s % 60)} s`
  return `${Math.floor(m / 60)} h ${pad(m % 60)} min`
}

export function fullDate(ts: number): string {
  return new Date(ts).toLocaleString(dateLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
