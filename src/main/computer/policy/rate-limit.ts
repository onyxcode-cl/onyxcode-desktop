/**
 * Límites de tasa del MCP de Control del PC, por sesión y con reloj inyectado (plan C §3). Puro.
 * Al superarlos el llamador responde «demasiado rápido» SIN detener el control (no es un kill).
 * Las llamadas rechazadas no consumen cuota.
 */

export interface RateLimits {
  perSecond: number
  perTenMinutes: number
  typeCharsPerCall: number
  typeCharsPerMinute: number
  requestAccessPerMinute: number
}

export const DEFAULT_LIMITS: RateLimits = {
  perSecond: 5,
  perTenMinutes: 600,
  typeCharsPerCall: 2000,
  typeCharsPerMinute: 20000,
  requestAccessPerMinute: 10
}

/** Herramientas que no cuentan como «acciones» (peticiones de permiso, modo guía y espera). */
export const NON_ACTION_TOOLS: ReadonlySet<string> = new Set(['request_access', 'request_full_control', 'teach_step', 'teach_end', 'wait'])

export type RateRule = 'per-second' | 'per-10-min' | 'type-call' | 'type-minute' | 'request-access' | 'invalid'

export type RateVerdict = { ok: true } | { ok: false; rule: RateRule; retryAfterMs: number; reason: string }

interface SessionState {
  actions: number[]
  typed: Array<[number, number]>
  access: number[]
}

const SECOND = 1000
const MINUTE = 60_000
const TEN_MIN = 600_000

export interface RateLimiter {
  /** Comprueba y, si procede, registra la llamada. `textLen` solo para `type_text` (longitud en caracteres). */
  check(session: string, tool: string, opts?: { textLen?: number }): RateVerdict
  forget(session: string): void
}

const tooFast = (rule: RateRule, retryAfterMs: number, what: string): RateVerdict => ({
  ok: false,
  rule,
  retryAfterMs: Math.max(1, Math.ceil(retryAfterMs)),
  reason: `Demasiado rápido: ${what}. Espera un momento y reduce el ritmo.`
})

export function createRateLimiter(now: () => number, limits: Partial<RateLimits> = {}): RateLimiter {
  const L: RateLimits = { ...DEFAULT_LIMITS, ...limits }
  const sessions = new Map<string, SessionState>()

  // La ventana (t - w, t]: una marca a exactamente `w` ms ya no cuenta.
  const prune = (arr: number[], t: number, w: number): void => {
    let i = 0
    while (i < arr.length && arr[i] <= t - w) i++
    if (i) arr.splice(0, i)
  }

  return {
    check(session, tool, opts = {}) {
      const t = now()
      let s = sessions.get(session)
      if (!s) sessions.set(session, (s = { actions: [], typed: [], access: [] }))
      prune(s.actions, t, TEN_MIN)
      prune(s.access, t, MINUTE)
      while (s.typed.length && s.typed[0][0] <= t - MINUTE) s.typed.shift()

      if (tool === 'request_access') {
        if (s.access.length >= L.requestAccessPerMinute)
          return tooFast('request-access', s.access[0] + MINUTE - t, 'demasiadas peticiones de acceso por minuto')
        s.access.push(t)
        return { ok: true }
      }
      if (NON_ACTION_TOOLS.has(tool)) return { ok: true }

      let chars = 0
      if (tool === 'type_text') {
        chars = opts.textLen ?? NaN
        if (!Number.isFinite(chars) || chars < 0)
          return { ok: false, rule: 'invalid', retryAfterMs: 0, reason: 'Longitud de texto no válida' }
        if (chars > L.typeCharsPerCall) {
          return {
            ok: false,
            rule: 'type-call',
            retryAfterMs: 0,
            reason: `Demasiado texto en una llamada (máximo ${L.typeCharsPerCall} caracteres): divídelo en partes.`
          }
        }
        const used = s.typed.reduce((a, [, n]) => a + n, 0)
        if (used + chars > L.typeCharsPerMinute)
          return tooFast('type-minute', s.typed[0][0] + MINUTE - t, 'demasiado texto tecleado en el último minuto')
      }

      if (s.actions.length >= L.perTenMinutes) return tooFast('per-10-min', s.actions[0] + TEN_MIN - t, 'demasiadas acciones en 10 minutos')
      let inSecond = 0
      for (let i = s.actions.length - 1; i >= 0 && s.actions[i] > t - SECOND; i--) inSecond++
      if (inSecond >= L.perSecond) {
        const oldest = s.actions[s.actions.length - L.perSecond]
        return tooFast('per-second', oldest + SECOND - t, `más de ${L.perSecond} acciones por segundo`)
      }
      s.actions.push(t)
      if (chars > 0) s.typed.push([t, chars])
      return { ok: true }
    },
    forget(session) {
      sessions.delete(session)
    }
  }
}
