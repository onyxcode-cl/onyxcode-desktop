/**
 * Enlace del celular con el Mac (PWA completa, F8-B56). TypeScript puro, sin DOM ni Node: lo usan el arranque ligero
 * (`pwa/src`, que posee la conexión WebRTC y el multiplexor) y los shims del renderer (`src/renderer/remote`), que solo
 * ven esta interfaz. Así los shims se prueban con un enlace falso y el arranque ligero no importa nada de React.
 *
 * Errores tipados: todo lo que falla por el puente llega como `RemoteLinkError` con un `code` que la interfaz puede mostrar
 * (`disconnected`, `forbidden`, `locked`, `unavailable`, `busy`…). La cancelación (`AbortSignal`) es un `AbortError` normal.
 * Las mutaciones NUNCA se reintentan solas: un fallo es definitivo hasta que la persona lo repita.
 */
import type { HttpRequest, SubHandlers, Subscription } from './mux'

export type { HttpRequest, SubHandlers, Subscription }

/** Estado del canal visto por los shims (derivado del estado de la conexión del arranque ligero). */
export type LinkStatus = 'connecting' | 'online' | 'locked' | 'reconnecting' | 'offline'

export interface RemoteLink {
  status(): LinkStatus
  /** Avisa de cada cambio de estado. Devuelve la baja. */
  onStatus(fn: (s: LinkStatus) => void): () => void
  /** Llamada IPC al Mac. Resuelve con el `data` del canal (sin envoltorio). */
  call(ch: string, p?: unknown, signal?: AbortSignal): Promise<unknown>
  /** Petición HTTP al motor `eng` a través del Mac. Resuelve con `HttpResult`. */
  http(req: HttpRequest, signal?: AbortSignal): Promise<unknown>
  /** Suscripción a eventos de un motor; `null` si no hay canal abierto. */
  subscribe(eng: string, h: SubHandlers, since?: number): Subscription | null
}

/** Respuesta de `http` (la forma que devuelve `engine-proxy.ts`). */
export interface HttpResult {
  status: number
  contentType?: string
  body: string
  encoding?: 'base64'
}

export type LinkErrorCode =
  | 'disconnected'
  | 'forbidden'
  | 'locked'
  | 'denied'
  | 'expired'
  | 'unavailable'
  | 'busy'
  | 'rate-limited'
  | 'too-large'
  | 'bad-request'
  | 'not-found'
  | 'unsupported'
  | 'failed'

export class RemoteLinkError extends Error {
  constructor(
    readonly code: LinkErrorCode,
    message: string,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'RemoteLinkError'
  }
}

export const isRemoteLinkError = (e: unknown): e is RemoteLinkError => e instanceof RemoteLinkError

export const isAbortError = (e: unknown): boolean => typeof e === 'object' && e !== null && (e as { name?: unknown }).name === 'AbortError'

/** Error de cancelación estándar (`fetch` real rechaza con un `DOMException` `AbortError`). */
export function abortError(): Error {
  const e = new Error('The operation was aborted.')
  e.name = 'AbortError'
  return e
}

const KNOWN: ReadonlySet<string> = new Set([
  'disconnected',
  'forbidden',
  'unavailable',
  'busy',
  'rate-limited',
  'too-large',
  'bad-request',
  'not-found',
  'unsupported',
  'failed'
])

/**
 * Traduce lo que lanza el multiplexor (`MuxCallError{code,detail}`) o el arranque ligero (`Error('offline')`) a un error
 * tipado. `forbidden` con detalle `locked` = PIN pedido; con `rejected` = el dueño dijo que no en el Mac; `expired` = la
 * confirmación caducó. La cancelación se deja como `AbortError`. `text` pone el mensaje legible (idioma de la interfaz).
 */
export function toLinkError(e: unknown, text: (code: LinkErrorCode) => string): Error {
  if (isAbortError(e)) return e as Error
  if (e instanceof RemoteLinkError) return e
  const o = typeof e === 'object' && e !== null ? (e as { name?: unknown; message?: unknown; code?: unknown; detail?: unknown }) : {}
  const raw = typeof o.code === 'string' ? o.code : typeof o.message === 'string' ? o.message : ''
  const detail = typeof o.detail === 'string' ? o.detail : undefined
  if (raw === 'cancelled') return abortError()
  let code: LinkErrorCode
  if (raw === 'forbidden') {
    // El Mac responde `forbidden` también para el resultado de una confirmación («D»): el detalle dice cuál fue.
    code =
      detail === 'locked'
        ? 'locked'
        : detail === 'rejected' || detail === 'cancelled'
          ? 'denied'
          : detail === 'expired'
            ? 'expired'
            : detail === 'busy'
              ? 'busy'
              : detail === 'rate-limited'
                ? 'rate-limited'
                : 'forbidden'
  } else if (raw === 'offline' || raw === 'closed' || raw === 'timeout') code = 'disconnected'
  else code = KNOWN.has(raw) ? (raw as LinkErrorCode) : 'failed'
  return new RemoteLinkError(code, text(code), detail)
}

/**
 * Cuenta las llamadas que llevan demasiado tiempo sin respuesta. Una acción «peligrosa» espera la confirmación del dueño en
 * el Mac (hasta 90 s): la interfaz no sabe cuál lo es, así que muestra «esperando al Mac» cuando alguna pasa de `ms`.
 */
export class SlowTracker {
  private slow = 0

  constructor(
    private readonly onChange: (slow: number) => void,
    private readonly ms = 1_500,
    private readonly timers: {
      set: (fn: () => void, ms: number) => unknown
      clear: (h: unknown) => void
    } = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) }
  ) {}

  get count(): number {
    return this.slow
  }

  track<T>(p: Promise<T>): Promise<T> {
    let marked = false
    const h = this.timers.set(() => {
      marked = true
      this.slow++
      this.onChange(this.slow)
    }, this.ms)
    const done = (): void => {
      this.timers.clear(h)
      if (marked) {
        marked = false
        this.slow--
        this.onChange(this.slow)
      }
    }
    p.then(done, done)
    return p
  }
}
