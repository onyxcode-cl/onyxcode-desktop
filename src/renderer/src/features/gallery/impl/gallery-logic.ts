/** Lógica pura de la galería «Lo que has creado»: filtros, buscador, agrupación por fecha y texto de fechas. Sin React ni IPC. */
import type { GalleryItem, GalleryOrigin, GalleryType } from '@shared/ipc-extras'

export type TypeFilter = 'all' | GalleryType
export type DateFilter = 'any' | 'today' | 'week' | 'month'
export type OriginFilter = 'all' | GalleryOrigin

export interface GalleryFilters {
  type: TypeFilter
  date: DateFilter
  origin: OriginFilter
  query: string
}

export const NO_FILTERS: GalleryFilters = { type: 'all', date: 'any', origin: 'all', query: '' }

/** Los filtros por tipo que se ofrecen (Imágenes y Texto solo aparecen si hay algo de ese tipo). */
export const TYPE_ORDER: readonly GalleryType[] = ['document', 'sheet', 'slides', 'web', 'pdf', 'image', 'text']
const ALWAYS: ReadonlySet<GalleryType> = new Set(['document', 'sheet', 'slides', 'web', 'pdf'])

const DAY = 24 * 60 * 60 * 1000

export function startOfDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Sin tildes ni mayúsculas, para que «planilla» encuentre «Planilla de gastos». */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export function filterItems(items: readonly GalleryItem[], f: GalleryFilters, now: number): GalleryItem[] {
  const q = fold(f.query.trim())
  const sinceByDate: Record<DateFilter, number> = {
    any: 0,
    today: startOfDay(now),
    week: startOfDay(now) - 6 * DAY,
    month: startOfDay(now) - 29 * DAY
  }
  const since = sinceByDate[f.date]
  return items.filter(
    (i) =>
      (f.type === 'all' || i.type === f.type) &&
      (f.origin === 'all' || i.origin === f.origin) &&
      i.createdAt >= since &&
      (!q || fold(i.name).includes(q))
  )
}

/** Tipos a mostrar como píldoras, con su cuenta (sobre todo lo que hay, no sobre lo filtrado). */
export function typeChips(items: readonly GalleryItem[]): { type: GalleryType; count: number }[] {
  const counts = new Map<GalleryType, number>()
  for (const i of items) counts.set(i.type, (counts.get(i.type) ?? 0) + 1)
  return TYPE_ORDER.filter((t) => ALWAYS.has(t) || (counts.get(t) ?? 0) > 0).map((type) => ({ type, count: counts.get(type) ?? 0 }))
}

export interface GalleryGroup {
  key: string
  /** `week` = «Esta semana»; si no, el mes (y el año si no es el actual). */
  kind: 'week' | 'month'
  label: string
  items: GalleryItem[]
}

/** Agrupa (ya ordenado de más nuevo a más viejo): los últimos 7 días juntos y luego por mes. */
export function groupItems(items: readonly GalleryItem[], now: number, lang: string, weekLabel: string): GalleryGroup[] {
  const weekStart = startOfDay(now) - 6 * DAY
  const year = new Date(now).getFullYear()
  const groups: GalleryGroup[] = []
  for (const i of [...items].sort((a, b) => b.createdAt - a.createdAt)) {
    let key: string
    let label: string
    let kind: GalleryGroup['kind']
    if (i.createdAt >= weekStart) {
      key = 'week'
      label = weekLabel
      kind = 'week'
    } else {
      const d = new Date(i.createdAt)
      key = `${d.getFullYear()}-${d.getMonth()}`
      const month = new Intl.DateTimeFormat(lang, { month: 'long' }).format(d)
      label = d.getFullYear() === year ? month : `${month} ${d.getFullYear()}`
      kind = 'month'
    }
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(i)
    else groups.push({ key, kind, label, items: [i] })
  }
  return groups
}

/** «hoy, 10:58» · «ayer» · «mar 13 oct» · «13 oct 2025». */
export function whenText(
  createdAt: number,
  now: number,
  lang: string,
  t: (key: 'gallery.when.today' | 'gallery.when.yesterday', params?: Record<string, string>) => string
): string {
  const today = startOfDay(now)
  if (createdAt >= today) {
    const time = new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(createdAt))
    return t('gallery.when.today', { time })
  }
  if (createdAt >= today - DAY) return t('gallery.when.yesterday')
  const d = new Date(createdAt)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  const opts: Intl.DateTimeFormatOptions =
    createdAt >= today - 6 * DAY
      ? { weekday: 'short', day: 'numeric', month: 'short' }
      : sameYear
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'short', year: 'numeric' }
  return new Intl.DateTimeFormat(lang, opts).format(d).replace(/\./g, '')
}
