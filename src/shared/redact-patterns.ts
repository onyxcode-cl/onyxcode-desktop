/**
 * Patrones de secretos compartidos por `redactSecrets` (errores de la IA, renderer) y el redactor de
 * Diagnóstico (main). Todos son lineales: sin cuantificadores anidados ni alternativas solapadas, de modo
 * que una línea de 1 MB no puede provocar ReDoS.
 */
const MASK = '…'

/** Clave=valor / clave: valor con nombre sospechoso (api_key, token, authorization…): oculta el valor (y un posible «Bearer »). */
const KEY_VALUE_RE =
  /\b((?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|token|secret|password|passwd|authorization|x-api-key)["']?\s*[=:]\s*["']?)(?:(?:Bearer|Basic)\s+)?[^\s"',;&]+/gi

/** Patrones simples: se sustituye toda la coincidencia. */
const WHOLE: RegExp[] = [
  /\bBearer\s+[^\s"',;]+/gi,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bAIza[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g,
  /\bsk_[A-Za-z0-9_]{8,}/g,
  /\b(?:key|token)[-_][A-Za-z0-9_-]{8,}/gi
]

/** `https://usuario:clave@host` → `https://…@host`. */
const URL_CREDENTIALS_RE = /(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi
/** `?key=…`, `&token=…`: oculta el valor y conserva el nombre. */
const URL_PARAM_RE = /([?&](?:key|token|api_key|apikey|access_token|auth|secret|password)=)[^&\s"']+/gi
/** Rachas largas de hex/base64url (claves sin prefijo conocido). Se decide en la función: ver `maskLongRuns`. */
const LONG_RUN_RE = /[A-Za-z0-9_-]{32,}/g

/** Oculta rachas ≥ 32 caracteres con letras y cifras (claves); deja pasar nombres largos de solo letras/guiones. */
function maskLongRuns(text: string): string {
  return text.replace(LONG_RUN_RE, (m) =>
    /[0-9]/.test(m) && /[A-Za-z]/.test(m) && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m) ? MASK : m
  )
}

/** Aplica todos los patrones de secretos. */
export function maskSecretPatterns(text: string): string {
  let out = text.replace(URL_CREDENTIALS_RE, `$1${MASK}@`)
  out = out.replace(URL_PARAM_RE, `$1${MASK}`)
  out = out.replace(KEY_VALUE_RE, `$1${MASK}`)
  for (const re of WHOLE) out = out.replace(re, MASK)
  return maskLongRuns(out)
}

export const REDACT_MASK = MASK
