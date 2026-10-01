/**
 * Errores de la IA en español claro: clasifica lo que devuelve OpenCode (errores de sesión del SDK,
 * `Error`, cadenas) y separa el mensaje para personas del detalle técnico (que va plegado y redactado).
 * Sin React ni IPC: se prueba con `ai-errors.test.ts`.
 */

import { t as tr } from './i18n'
import { es } from './i18n/es'
import { maskSecretPatterns } from './redact-patterns'

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

/** Versión en español (mensaje de la excepción); la interfaz usa `noAiTitle()` / `noAiBody()` en el idioma activo. */
export const NO_AI_TITLE = es['errors.noAi.title']
export const NO_AI_BODY = es['errors.noAi.body']
export const noAiTitle = (): string => tr('errors.noAi.title')
export const noAiBody = (): string => tr('errors.noAi.body')

/** Se lanza al intentar enviar sin ninguna IA conectada. */
export class NoAiError extends Error {
  constructor() {
    super(NO_AI_BODY)
    this.name = 'NoAiError'
  }
}
export const NO_AI_ERROR = new NoAiError()

const DETAIL_MAX = 2000

/** Sustituye por «…» lo que parece una clave o un token (mismos patrones que el redactor de Diagnóstico). */
export function redactSecrets(text: string): string {
  return maskSecretPatterns(text)
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
    return (key && opts.providerNames?.[key]) || key || tr('errors.yourAi')
  }

  if (n.name === 'NoAiError') {
    return { kind: 'no-ai', title: noAiTitle(), message: noAiBody(), detail: null, action: 'connect' }
  }
  if (n.name === 'ContextOverflowError') {
    return {
      kind: 'context',
      title: tr('errors.context.title'),
      message: tr('errors.context.message'),
      detail,
      action: null
    }
  }
  if (NOT_FOUND_RE.test(text)) {
    const id = /Model not found:\s*(\S+?)\.?(?:\s|$)/.exec(n.message)?.[1] ?? tr('errors.modelNotFound.fallbackId')
    return {
      kind: 'model-not-found',
      title: tr('errors.modelNotFound.title'),
      message: tr('errors.modelNotFound.message', { id }),
      detail,
      action: 'connect'
    }
  }
  const authFailure = (): FriendlyError => ({
    kind: 'auth',
    title: tr('errors.auth.title'),
    message: tr('errors.auth.message', { provider: providerLabel(n.providerID) }),
    detail,
    action: 'connect'
  })
  if (n.name === 'ProviderAuthError' || n.statusCode === 401 || n.statusCode === 403) return authFailure()
  if (n.statusCode === 402 || n.statusCode === 429 || QUOTA_RE.test(text)) {
    return {
      kind: 'quota',
      title: tr('errors.quota.title'),
      message: tr('errors.quota.message'),
      detail,
      action: null
    }
  }
  if (AUTH_RE.test(text)) return authFailure()
  if (NETWORK_RE.test(text)) {
    return {
      kind: 'network',
      title: tr('errors.network.title'),
      message: tr('errors.network.message'),
      detail,
      action: null
    }
  }
  if (n.statusCode === null && !n.responseBody && isPlainMessage(n.message)) {
    return { kind: 'unknown', title: tr('errors.unknown.title'), message: redactSecrets(n.message.trim()), detail: null, action: null }
  }
  return { kind: 'unknown', title: tr('errors.unknown.title'), message: tr('errors.unknown.message'), detail, action: null }
}
