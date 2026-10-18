/**
 * Todo lo que SALE hacia Telegram pasa por aquí: tapado de secretos, recorte y escape de HTML.
 * Orden obligatorio: tapar → recortar → escapar (si se recortara antes, una clave partida por la mitad quedaría a la vista).
 */
import { maskSecretPatterns } from '@shared/redact-patterns'
import { TELEGRAM_LIMITS } from '@shared/telegram'

/** Un token de bot, esté donde esté (incluida una URL `…/bot<token>/…`). */
const BOT_TOKEN_RE = /(?:bot)?\d{6,12}:[A-Za-z0-9_-]{30,}/g
/** Cabeceras y llaves privadas pegadas en un comando. */
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g

const ELLIPSIS = '…'

/** Tapa claves y tokens (patrones compartidos de la app + token de bot de Telegram + llaves privadas). */
export function redactForTelegram(text: string): string {
  return maskSecretPatterns(text.replace(PRIVATE_KEY_RE, ELLIPSIS).replace(BOT_TOKEN_RE, ELLIPSIS))
}

/** Escapa lo único que `parse_mode: HTML` interpreta. Se aplica SIEMPRE a todo texto dinámico. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Quita caracteres de control (salvo salto de línea y tabulación): no tienen sentido en un mensaje y algunos confunden a los clientes. */
const CONTROL_RE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]', 'g')
export function stripControl(text: string): string {
  return text.replace(CONTROL_RE, '')
}

/** Si `text` pasa de `max`, deja el inicio y el final con un aviso en medio (cuántos caracteres se omiten). */
export function truncateMiddle(text: string, max: number, omittedLabel: (n: number) => string = (n) => `[… ${n} …]`): string {
  if (text.length <= max) return text
  const marker = `\n${omittedLabel(text.length - max)}\n`
  const room = Math.max(0, max - marker.length)
  const head = Math.ceil(room * 0.6)
  const tail = room - head
  const omitted = text.length - head - tail
  return text.slice(0, head) + `\n${omittedLabel(omitted)}\n` + (tail > 0 ? text.slice(text.length - tail) : '')
}

/**
 * Texto de un bloque del mensaje: tapado, sin controles, recortado a `max` caracteres y que, YA ESCAPADO, no pase de `budget`.
 * Devuelve el texto escapado listo para insertarse en el HTML.
 */
export function safeBlock(raw: string, opts: { max?: number; budget?: number; omittedLabel?: (n: number) => string } = {}): string {
  const max = opts.max ?? TELEGRAM_LIMITS.commandMax
  const budget = opts.budget ?? TELEGRAM_LIMITS.messageMax
  const clean = stripControl(redactForTelegram(raw))
  let n = Math.min(max, clean.length)
  for (let i = 0; i < 40; i++) {
    const escaped = escapeHtml(truncateMiddle(clean, n, opts.omittedLabel))
    if (escaped.length <= budget) return escaped
    n = Math.max(40, Math.floor(n * 0.8))
  }
  return escapeHtml(truncateMiddle(clean, 40, opts.omittedLabel)).slice(0, budget)
}

/** Texto corto en una línea (título de conversación, motivo de error): tapado, una línea, recortado y escapado. */
export function safeLine(raw: string, max = 80): string {
  const one = stripControl(redactForTelegram(raw)).replace(/\s+/g, ' ').trim()
  const cut = one.length > max ? `${one.slice(0, max - 1)}${ELLIPSIS}` : one
  return escapeHtml(cut)
}

/** Tapa el token y todo patrón de clave en un texto que va a un registro (nunca debe aparecer el token en los registros). */
export function scrubToken(text: string, token?: string | null): string {
  let out = text
  if (token && token.length >= 8) out = out.split(token).join(ELLIPSIS)
  return redactForTelegram(out)
}
