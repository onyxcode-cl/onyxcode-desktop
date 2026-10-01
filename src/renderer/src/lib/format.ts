/** Formateo de números, tokens y costos (es-CL; en-US con la interfaz en inglés) compartido por la UI. */
import { getLang } from '@shared/i18n'

const loc = (): string => (getLang() === 'en' ? 'en-US' : 'es-CL')

export function formatNumber(n: number): string {
  return new Intl.NumberFormat(loc()).format(Math.round(n))
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString(loc(), { maximumFractionDigits: 2 })} M`
  if (n >= 1_000) return `${(n / 1_000).toLocaleString(loc(), { maximumFractionDigits: 1 })} k`
  return formatNumber(n)
}

export function formatCost(n: number): string {
  return new Intl.NumberFormat(loc(), { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 }).format(n)
}

/** Texto de un error capturado: `message` si es Error, si no `String(err)`. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
