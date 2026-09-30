/**
 * Errores de la IA en español claro: clasifica lo que devuelve OpenCode (errores de sesión del SDK,
 * `Error`, cadenas) y separa el mensaje para personas del detalle técnico (que va plegado y redactado).
 * Sin React ni IPC: se prueba con `ai-errors.test.ts`.
 */

export type FriendlyErrorKind = 'no-ai' | 'model-not-found' | 'auth' | 'network' | 'quota' | 'context' | 'unknown'

export interface FriendlyError {
  kind: FriendlyErrorKind
  title: string
  message: string
  /** Texto técnico para «Ver detalle» (redactado y recortado); `null` si el mensaje ya es el original. */
  detail: string | null
  /** `connect` = ofrecer el botón «Conectar una IA». */
  action: 'connect' | null
}

export interface FriendlyErrorOptions {
  /** Nombres visibles por id de proveedor (salen de `Provider.name` en tiempo de ejecución). */
  providerNames?: Record<string, string>
  /** Proveedor implicado cuando el error no lo indica. */
  providerID?: string
}

export const NO_AI_TITLE = 'Aún no conectaste ninguna IA'
export const NO_AI_BODY =
  'Para enviar mensajes necesitas conectar una IA: tu suscripción de OpenCode Go o la clave de otro proveedor. Solo toma un minuto.'

/** Se lanza al intentar enviar sin ninguna IA conectada. */
export class NoAiError extends Error {
  constructor() {
    super(NO_AI_BODY)
    this.name = 'NoAiError'
  }
}
export const NO_AI_ERROR = new NoAiError()

const DETAIL_MAX = 2000
const SECRET_RE = /\b(sk|key|token)[-_][A-Za-z0-9_-]{8,}/gi

/** Sustituye por «…» lo que parece una clave o un token. */
export function redactSecrets(text: string): string {
  return text.replace(SECRET_RE, '…')
}

interface Normalized {
  name: string
  message: string
  statusCode: number | null
  responseBody: string | null
  providerID: string | null
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

function normalize(err: unknown): Normalized {
  const n: Normalized = { name: '', message: '', statusCode: null, responseBody: null, providerID: null }
  if (typeof err === 'string') {
    n.message = err
    return n
  }
  if (err instanceof Error) {
    n.name = err.name
    n.message = err.message
    return n
  }
  if (err && typeof err === 'object') {
    const o = err as { name?: unknown; message?: unknown; data?: unknown }
    n.name = str(o.name) ?? ''
    const d = o.data && typeof o.data === 'object' ? (o.data as Record<string, unknown>) : {}
    n.message = str(d.message) ?? str(o.message) ?? ''
    if (typeof d.statusCode === 'number') n.statusCode = d.statusCode
    n.responseBody = str(d.responseBody)
    n.providerID = str(d.providerID)
  }
  return n
}

function buildDetail(n: Normalized): string {
  const lines: string[] = []
  if (n.name) lines.push(n.name)
  if (n.message) lines.push(n.message)
  if (n.statusCode !== null) lines.push(`statusCode: ${n.statusCode}`)
  if (n.responseBody) lines.push(n.responseBody)
  return redactSecrets(lines.join('\n')).slice(0, DETAIL_MAX)
}

const NETWORK_RE = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|socket hang up/i
const QUOTA_RE = /rate.?limit|quota|insufficient|credit|too many requests/i
const AUTH_RE = /unauthorized|invalid api key|invalid_api_key/i
const NOT_FOUND_RE = /ProviderModelNotFoundError|Model not found:/

/** Una sola línea, sin rastro de pila y sin prefijo `XxxError:` ⇒ es un mensaje propio, se muestra tal cual. */
function isPlainMessage(text: string): boolean {
  const t = text.trim()
  if (!t || t.includes('\n')) return false
  if (/^\s*at\s/.test(t) || /\bat\s+\S+\s*\(/.test(t) || /\$bunfs/.test(t)) return false
  return !/^\w*Error:/.test(t)
}

export function friendlyError(err: unknown, opts: FriendlyErrorOptions = {}): FriendlyError {
  const n = normalize(err)
  const text = `${n.name} ${n.message}`
  const detail = buildDetail(n) || null
  const providerLabel = (id: string | null): string => {
    const key = id ?? opts.providerID ?? null
    return (key && opts.providerNames?.[key]) || key || 'tu IA'
  }

  if (n.name === 'NoAiError') {
    return { kind: 'no-ai', title: NO_AI_TITLE, message: NO_AI_BODY, detail: null, action: 'connect' }
  }
  if (n.name === 'ContextOverflowError') {
    return {
      kind: 'context',
      title: 'La conversación es demasiado larga',
      message: 'Empieza una conversación nueva para seguir.',
      detail,
      action: null
    }
  }
  if (NOT_FOUND_RE.test(text)) {
    const id = /Model not found:\s*(\S+?)\.?(?:\s|$)/.exec(n.message)?.[1] ?? 'el modelo'
    return {
      kind: 'model-not-found',
      title: 'El modelo elegido no está disponible',
      message: `“${id}” no pertenece a ninguna IA conectada. Elige otro modelo o conecta una IA.`,
      detail,
      action: 'connect'
    }
  }
  const authFailure = (): FriendlyError => ({
    kind: 'auth',
    title: 'La IA rechazó la conexión',
    message: `La clave o la sesión de ${providerLabel(n.providerID)} no es válida o caducó. Vuelve a conectarla en Ajustes › Modelos.`,
    detail,
    action: 'connect'
  })
  if (n.name === 'ProviderAuthError' || n.statusCode === 401 || n.statusCode === 403) return authFailure()
  if (n.statusCode === 402 || n.statusCode === 429 || QUOTA_RE.test(text)) {
    return {
      kind: 'quota',
      title: 'Límite de uso alcanzado',
      message: 'Tu IA alcanzó su límite de uso o de cuota. Espera unos minutos o revisa tu plan.',
      detail,
      action: null
    }
  }
  if (AUTH_RE.test(text)) return authFailure()
  if (NETWORK_RE.test(text)) {
    return {
      kind: 'network',
      title: 'Sin conexión',
      message: 'No se pudo contactar con la IA. Revisa tu conexión a internet e inténtalo de nuevo.',
      detail,
      action: null
    }
  }
  if (n.statusCode === null && !n.responseBody && isPlainMessage(n.message)) {
    return { kind: 'unknown', title: 'Algo salió mal', message: redactSecrets(n.message.trim()), detail: null, action: null }
  }
  return { kind: 'unknown', title: 'Algo salió mal', message: 'OpenCode devolvió un error inesperado.', detail, action: null }
}
