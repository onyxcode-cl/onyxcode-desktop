/**
 * Espera exponencial con azar para relanzar `cloudflared` tras una caída: 2, 4, 8, 16, 32, 60 s (tope), máximo 6 intentos
 * seguidos. Un error `rate` (Cloudflare limita crear túneles) empieza ya en 60 s. Puro; el azar se inyecta.
 */
import { TRAVEL_PROCESS } from '@shared/remote/travel'

/** Espera (ms) antes del intento `attempt` (1-based). `rand` ∈ [0,1): ±25 % de azar, siempre dentro de [2 s, 60 s]. */
export function backoffDelayMs(attempt: number, opts: { rate?: boolean; rand?: () => number } = {}): number {
  const { backoffMinMs: min, backoffMaxMs: max } = TRAVEL_PROCESS
  if (opts.rate) return max
  const n = Math.max(1, Math.trunc(attempt))
  const base = Math.min(max, min * 2 ** (n - 1))
  const jitter = 0.75 + (opts.rand ?? Math.random)() * 0.5
  return Math.max(min, Math.min(max, Math.round(base * jitter)))
}

/** ¿Quedan intentos? (`failures` = muertes seguidas ya ocurridas). */
export function canRestart(failures: number): boolean {
  return failures < TRAVEL_PROCESS.maxRestarts
}
