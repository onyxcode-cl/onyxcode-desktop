/**
 * Cliente mínimo de la API de bots de Telegram (solo lo que usa la entrega 1) con `fetch` inyectable.
 *
 * Reglas:
 *  - La dirección base es FIJA (`https://api.telegram.org`). Solo una variable de entorno de pruebas puede cambiarla y SOLO cuando
 *    la app NO está empaquetada (`resolveApiBase`); nunca sale de un ajuste, un archivo ni el renderer. Aun así solo admite un
 *    servidor local (loopback), para que ni un entorno de desarrollo mal configurado mande el token a otro sitio.
 *  - El token vive solo en la URL de la petición; todo error y todo registro lo tapa (`TelegramApiError.message` nunca lo lleva).
 *  - 429: espera `retry_after` (con tope) y reintenta unas pocas veces; el resto de errores se devuelve con un código estable.
 *  - Las peticiones de escritura van en serie con una separación mínima (Telegram limita ~1 mensaje por segundo por chat).
 */
import { scrubToken } from './text'

export const TELEGRAM_API_BASE = 'https://api.telegram.org'
/** Variable de entorno con la dirección de un servidor de Telegram FALSO (solo pruebas y desarrollo, sin empaquetar). */
export const TELEGRAM_API_ENV = 'LAZUNOX_TELEGRAM_API_BASE'

const LOOPBACK_RE = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/i

/**
 * Dirección base efectiva. En producción SIEMPRE `https://api.telegram.org`. Con la app sin empaquetar (desarrollo o pruebas)
 * y la variable puesta con una dirección `http://127.0.0.1:<puerto>` (o `localhost`/`[::1]`), esa. Cualquier otra cosa se ignora.
 */
export function resolveApiBase(o: { isPackaged: boolean; env: Record<string, string | undefined> }): string {
  if (o.isPackaged) return TELEGRAM_API_BASE
  const raw = o.env[TELEGRAM_API_ENV]
  if (typeof raw === 'string') {
    const v = raw.trim().replace(/\/+$/, '')
    if (LOOPBACK_RE.test(v)) return v
  }
  return TELEGRAM_API_BASE
}

export type ApiErrorKind = 'unauthorized' | 'conflict' | 'rate-limited' | 'network' | 'bad-request' | 'forbidden' | 'server' | 'aborted'

export class TelegramApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    /** Código HTTP / de Telegram, si lo hubo. */
    readonly status: number | null,
    message: string,
    /** Segundos que pidió esperar Telegram (429). */
    readonly retryAfter: number | null = null
  ) {
    super(message)
    this.name = 'TelegramApiError'
  }
}

export interface TgUser {
  id: number
  is_bot?: boolean
  first_name?: string
  username?: string
}
export interface TgChat {
  id: number
  type: 'private' | 'group' | 'supergroup' | 'channel' | string
}
export interface TgMessage {
  message_id: number
  from?: TgUser
  chat: TgChat
  text?: string
}
export interface TgCallbackQuery {
  id: string
  from: TgUser
  message?: TgMessage
  data?: string
}
export interface TgUpdate {
  update_id: number
  message?: TgMessage
  callback_query?: TgCallbackQuery
  /** Otros tipos (canales, grupos, ediciones…): se descartan. */
  [k: string]: unknown
}

export interface InlineButton {
  text: string
  callback_data: string
}
export interface ReplyMarkup {
  inline_keyboard: InlineButton[][]
}

export interface TelegramApiOptions {
  token: string
  baseUrl?: string
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Separación mínima entre peticiones de escritura (ms). */
  minGapMs?: number
  /** Reintentos ante 429 (por petición). */
  maxRetries?: number
  /** Tope de la espera pedida por un 429 (s). */
  maxRetryAfterSec?: number
  /** Tiempo máximo de una petición normal (ms); getUpdates suma su espera larga. */
  timeoutMs?: number
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface ApiEnvelope<T> {
  ok: boolean
  result?: T
  error_code?: number
  description?: string
  parameters?: { retry_after?: number }
}

export class TelegramApi {
  private readonly base: string
  private readonly doFetch: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly now: () => number
  private readonly minGap: number
  private readonly maxRetries: number
  private readonly maxRetryAfter: number
  private readonly timeoutMs: number
  private lastWriteAt = 0
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(private readonly o: TelegramApiOptions) {
    this.base = (o.baseUrl ?? TELEGRAM_API_BASE).replace(/\/+$/, '')
    this.doFetch = o.fetch ?? fetch
    this.sleep = o.sleep ?? defaultSleep
    this.now = o.now ?? Date.now
    this.minGap = o.minGapMs ?? 350
    this.maxRetries = o.maxRetries ?? 3
    this.maxRetryAfter = o.maxRetryAfterSec ?? 60
    this.timeoutMs = o.timeoutMs ?? 20_000
  }

  /** Una llamada a la API. `signal` cancela (apagado o desvinculación). */
  async call<T>(
    method: string,
    params: Record<string, unknown>,
    opts: { signal?: AbortSignal; extraTimeoutMs?: number; write?: boolean } = {}
  ): Promise<T> {
    if (opts.write === false) return this.once<T>(method, params, opts)
    // Escrituras en serie y espaciadas.
    const run = async (): Promise<T> => {
      const wait = this.lastWriteAt + this.minGap - this.now()
      if (wait > 0) await this.sleep(wait)
      try {
        return await this.withRetries<T>(method, params, opts)
      } finally {
        this.lastWriteAt = this.now()
      }
    }
    const p = this.writeChain.then(run, run)
    this.writeChain = p.catch(() => undefined)
    return p
  }

  private async withRetries<T>(
    method: string,
    params: Record<string, unknown>,
    opts: { signal?: AbortSignal; extraTimeoutMs?: number }
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once<T>(method, params, opts)
      } catch (err) {
        if (err instanceof TelegramApiError && err.kind === 'rate-limited' && attempt < this.maxRetries && !opts.signal?.aborted) {
          const secs = Math.min(Math.max(err.retryAfter ?? 1, 1), this.maxRetryAfter)
          await this.sleep(secs * 1000)
          continue
        }
        throw err
      }
    }
  }

  private async once<T>(
    method: string,
    params: Record<string, unknown>,
    opts: { signal?: AbortSignal; extraTimeoutMs?: number }
  ): Promise<T> {
    const url = `${this.base}/bot${this.o.token}/${method}`
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs + (opts.extraTimeoutMs ?? 0))
    const onAbort = (): void => ctl.abort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      let res: Response
      try {
        res = await this.doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(params),
          signal: ctl.signal,
          redirect: 'error'
        })
      } catch (err) {
        if (opts.signal?.aborted) throw new TelegramApiError('aborted', null, 'cancelado')
        const detail = err instanceof Error ? scrubToken(err.message, this.o.token) : 'error de red'
        throw new TelegramApiError('network', null, detail.slice(0, 200))
      }
      let body: ApiEnvelope<T> | null = null
      try {
        body = (await res.json()) as ApiEnvelope<T>
      } catch {
        body = null
      }
      if (res.ok && body?.ok) return body.result as T
      const status = body?.error_code ?? res.status
      const desc = scrubToken(String(body?.description ?? `HTTP ${res.status}`), this.o.token).slice(0, 200)
      if (status === 429) throw new TelegramApiError('rate-limited', 429, desc, body?.parameters?.retry_after ?? null)
      if (status === 401) throw new TelegramApiError('unauthorized', 401, desc)
      if (status === 403) throw new TelegramApiError('forbidden', 403, desc)
      if (status === 409) throw new TelegramApiError('conflict', 409, desc)
      if (status >= 500) throw new TelegramApiError('server', status, desc)
      throw new TelegramApiError('bad-request', status, desc)
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  getMe(signal?: AbortSignal): Promise<TgUser & { username?: string }> {
    return this.call('getMe', {}, { signal, write: false })
  }

  /** Long polling. `timeoutSec` es la espera del servidor; la petición aguanta ese tiempo más el margen normal. */
  getUpdates(p: { offset: number; timeoutSec: number }, signal?: AbortSignal): Promise<TgUpdate[]> {
    return this.call<TgUpdate[]>(
      'getUpdates',
      { offset: p.offset, timeout: p.timeoutSec, limit: 50, allowed_updates: ['message', 'callback_query'] },
      { signal, extraTimeoutMs: p.timeoutSec * 1000, write: false }
    )
  }

  sendMessage(p: { chatId: number; text: string; markup?: ReplyMarkup }, signal?: AbortSignal): Promise<TgMessage> {
    return this.call<TgMessage>(
      'sendMessage',
      {
        chat_id: p.chatId,
        text: p.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        ...(p.markup ? { reply_markup: p.markup } : {})
      },
      { signal }
    )
  }

  /** Cambia el texto de un mensaje y, al omitir `markup`, QUITA los botones. */
  editMessageText(p: { chatId: number; messageId: number; text: string; markup?: ReplyMarkup }, signal?: AbortSignal): Promise<unknown> {
    return this.call(
      'editMessageText',
      {
        chat_id: p.chatId,
        message_id: p.messageId,
        text: p.text,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: p.markup ?? { inline_keyboard: [] }
      },
      { signal }
    )
  }

  answerCallbackQuery(p: { id: string; text?: string; alert?: boolean }, signal?: AbortSignal): Promise<boolean> {
    return this.call<boolean>(
      'answerCallbackQuery',
      { callback_query_id: p.id, ...(p.text ? { text: p.text.slice(0, 190) } : {}), ...(p.alert ? { show_alert: true } : {}) },
      { signal }
    )
  }
}
