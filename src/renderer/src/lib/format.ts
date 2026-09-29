/** Formateo de números, tokens y costos (es-CL) compartido por la UI. */

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-CL').format(Math.round(n))
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toLocaleString('es-CL', { maximumFractionDigits: 2 })} M`
  if (n >= 1_000) return `${(n / 1_000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} k`
  return formatNumber(n)
}

export function formatCost(n: number): string {
  return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 }).format(n)
}

/** Texto de un error capturado: `message` si es Error, si no `String(err)`. */
export function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
