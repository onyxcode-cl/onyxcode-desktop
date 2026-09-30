/**
 * Cuenta de la app: tipos y lógica PURA (sin red, sin disco, sin reloj propio). La usan main
 * (servicio de cuenta) y el renderer (pantalla de acceso). El token de sesión NUNCA sale de main:
 * nada de este módulo lo contiene.
 *
 * Apagada por defecto: con `ACCOUNT_API = null` (brand.ts) la app no exige iniciar sesión.
 */

/** Gracia sin conexión: con una sesión que se validó bien hace menos de esto, la app abre igual. */
export const GRACE_MS = 30 * 24 * 60 * 60 * 1000
/** Cada cuánto se vuelve a validar la sesión con el servidor mientras la app está abierta. */
export const REVALIDATE_MS = 24 * 60 * 60 * 1000
/** Holgura ante relojes desajustados: una validación «del futuro» más allá de esto se considera manipulada. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000

export type AccountStatus = 'signed-out' | 'signing-in' | 'signed-in' | 'grace' | 'expired' | 'deleted' | 'offline-blocked'

export type AccountProvider = 'google' | 'email'

/** Estado que ve el renderer. No incluye el token. */
export interface AccountState {
  /** false = cuenta apagada (ACCOUNT_API nulo): no se exige nada. */
  required: boolean
  status: AccountStatus
  email: string | null
  provider: AccountProvider | null
  /** Fin de la gracia sin conexión (ms epoch); solo con `status === 'grace'`. */
  graceEndsAt: number | null
  /** Validando la sesión guardada al arrancar (aún no se sabe si abre). */
  checking: boolean
  /** La sesión no se puede guardar en el Llavero (cifrado no disponible): dura solo hasta cerrar la app. */
  memoryOnly: boolean
}

export const INITIAL_ACCOUNT_STATE: AccountState = {
  required: false,
  status: 'signed-out',
  email: null,
  provider: null,
  graceEndsAt: null,
  checking: false,
  memoryOnly: false
}

/** Sesión guardada en main (cifrada). `token` no viaja al renderer. */
export interface StoredSession {
  token: string
  email: string
  provider: AccountProvider
}

/** Resultado de validar la sesión (`GET /v1/me`), ya reducido a lo que importa para decidir. */
export type ServerResult = { kind: 'ok' } | { kind: 'unreachable' } | { kind: 'http'; status: number }

export interface AccessDecision {
  /** La app puede usarse. */
  allowed: boolean
  status: AccountStatus
  /** Hay que borrar la sesión guardada (revocada/caducada/cuenta borrada). */
  clearSession: boolean
  graceEndsAt: number | null
}

/**
 * Decide si se abre la app.
 *  - sin sesión guardada: bloquea (`signed-out`);
 *  - el servidor confirma: abre;
 *  - 401 (revocada o caducada): bloquea al instante y borra la sesión;
 *  - 404/410 (cuenta borrada): bloquea y borra;
 *  - el servidor no responde (red caída, 5xx, 429…): abre mientras la última validación correcta
 *    tenga menos de 30 días; si no hay validación, es más antigua o viene «del futuro», bloquea.
 */
export function decideAccess(
  now: number,
  stored: StoredSession | null,
  lastValidation: number | null,
  result: ServerResult
): AccessDecision {
  if (!stored) return { allowed: false, status: 'signed-out', clearSession: false, graceEndsAt: null }
  if (result.kind === 'ok') return { allowed: true, status: 'signed-in', clearSession: false, graceEndsAt: null }
  if (result.kind === 'http') {
    if (result.status === 401) return { allowed: false, status: 'expired', clearSession: true, graceEndsAt: null }
    if (result.status === 404 || result.status === 410) return { allowed: false, status: 'deleted', clearSession: true, graceEndsAt: null }
  }
  // Sin respuesta útil del servidor: gracia.
  if (lastValidation !== null && Number.isFinite(lastValidation) && lastValidation <= now + CLOCK_SKEW_MS) {
    const end = lastValidation + GRACE_MS
    if (now < end) return { allowed: true, status: 'grace', clearSession: false, graceEndsAt: end }
  }
  return { allowed: false, status: 'offline-blocked', clearSession: false, graceEndsAt: null }
}

/** `true` si el estado deja usar la app (o no se exige cuenta). */
export function isAccessOpen(s: Pick<AccountState, 'required' | 'status' | 'checking'>): boolean {
  if (!s.required) return true
  return !s.checking && (s.status === 'signed-in' || s.status === 'grace')
}

export type AccountEvent =
  | { type: 'config'; required: boolean }
  | { type: 'memory-only'; value: boolean }
  | { type: 'checking'; value: boolean }
  | { type: 'signing-in' }
  | { type: 'cancel' }
  | { type: 'signed-in'; email: string; provider: AccountProvider }
  | { type: 'decision'; decision: AccessDecision; email: string | null; provider: AccountProvider | null }
  | { type: 'signed-out' }

/** Reductor del estado público. */
export function accountReducer(state: AccountState, e: AccountEvent): AccountState {
  switch (e.type) {
    case 'config':
      return { ...state, required: e.required }
    case 'memory-only':
      return { ...state, memoryOnly: e.value }
    case 'checking':
      return { ...state, checking: e.value }
    case 'signing-in':
      return { ...state, status: 'signing-in', checking: false, graceEndsAt: null }
    case 'cancel':
      // Cancelar solo vuelve a «sin cuenta» si se estaba entrando; no pisa un estado de error.
      return state.status === 'signing-in' ? { ...state, status: 'signed-out' } : state
    case 'signed-in':
      return { ...state, status: 'signed-in', email: e.email, provider: e.provider, graceEndsAt: null, checking: false }
    case 'decision': {
      const d = e.decision
      const keep = d.allowed || d.status === 'offline-blocked'
      return {
        ...state,
        status: d.status,
        email: keep ? e.email : null,
        provider: keep ? e.provider : null,
        graceEndsAt: d.graceEndsAt,
        checking: false
      }
    }
    case 'signed-out':
      return { ...state, status: 'signed-out', email: null, provider: null, graceEndsAt: null, checking: false }
  }
}

// --- Validación de entradas -------------------------------------------------------------------

export const EMAIL_MAX = 254
/** Forma razonable `algo@dominio.tld` (no pretende cubrir todo el RFC 5322; el servidor manda un código de verdad). */
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidEmail(raw: string): boolean {
  const e = raw.trim()
  if (e.length === 0 || e.length > EMAIL_MAX) return false
  const at = e.lastIndexOf('@')
  if (at < 1 || at > 64) return false // parte local ≤ 64
  if (e.includes('..') || e.startsWith('.') || e.slice(0, at).endsWith('.')) return false
  return EMAIL_RE.test(e)
}

export const CODE_LENGTH = 6
const CODE_RE = /^\d{6}$/

/** Código de 6 dígitos (sin espacios: la pantalla ya los quita al escribir). */
export function isValidCode(raw: string): boolean {
  return CODE_RE.test(raw)
}

/** Quita todo lo que no sea dígito y corta a 6 (pegar «123 456» funciona). */
export function cleanCodeInput(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
}
