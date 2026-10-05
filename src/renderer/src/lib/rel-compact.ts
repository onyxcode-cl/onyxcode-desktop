import { t } from '@shared/i18n'
import { dateLocale } from './i18n'

/** Hora relativa corta para las filas de la barra lateral de escritorio: «ahora», «12 min», «3 h», «ayer», «4 d» o la fecha. */
export function relCompact(ts: number, now = Date.now()): string {
  const min = Math.floor((now - ts) / 60_000)
  if (min < 1) return t('app.rel.now')
  if (min < 60) return t('app.rel.min', { n: min })
  const h = Math.floor(min / 60)
  if (h < 24) return t('app.rel.h', { n: h })
  const d = Math.floor(h / 24)
  if (d === 1) return t('app.rel.yesterday')
  if (d < 7) return t('app.rel.days', { n: d })
  return new Date(ts).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' })
}
