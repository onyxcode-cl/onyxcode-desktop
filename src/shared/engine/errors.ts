/**
 * Errores de la capa del motor (`EngineClient`).
 *
 * El adaptador traduce lo que devuelve el motor (códigos HTTP, cuerpos `{ data: { message } }`,
 * excepciones de red) a un `EngineError` con un `kind` estable. La UI decide el texto visible por
 * `kind` (con `t('clave')`); `message` es solo el detalle técnico del motor, nunca una frase de UI.
 */

/** Clases de fallo que el resto de la app puede distinguir sin mirar HTTP. */
export type EngineErrorKind =
  /** El motor (o este adaptador) no implementa la operación. */
  | 'unsupported'
  /** 401/403: credenciales ausentes o rechazadas. */
  | 'unauthorized'
  /** 404: sesión, mensaje, permiso o pregunta que ya no existe. */
  | 'notFound'
  /** 409: la operación choca con el estado actual (p. ej. sesión ocupada). */
  | 'conflict'
  /** 400/422: petición mal formada. */
  | 'badRequest'
  /** Sin respuesta: servidor caído, conexión cortada, tiempo agotado. */
  | 'network'
  /** La llamada se canceló desde nuestro lado (`AbortSignal`). */
  | 'aborted'
  /** Cualquier otro fallo que el motor reporta. */
  | 'engine'

export interface EngineErrorOptions {
  /** Código HTTP, si el fallo vino de una respuesta. */
  status?: number
  /** Error original (excepción o cuerpo de error del motor), solo para diagnóstico. */
  detail?: unknown
}

export class EngineError extends Error {
  readonly kind: EngineErrorKind
  readonly status?: number
  /** Error o cuerpo original del motor; no se muestra en la UI. */
  readonly detail?: unknown

  constructor(kind: EngineErrorKind, message?: string, options: EngineErrorOptions = {}) {
    super(message ?? kind)
    this.name = 'EngineError'
    this.kind = kind
    if (options.status !== undefined) this.status = options.status
    if (options.detail !== undefined) this.detail = options.detail
  }
}

export function isEngineError(err: unknown): err is EngineError {
  return err instanceof EngineError
}

/** Clase de fallo según el código HTTP. */
export function kindFromStatus(status: number): EngineErrorKind {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status === 400 || status === 422) return 'badRequest'
  return 'engine'
}

/**
 * Texto técnico de un error del motor o de una excepción. Reconoce las formas que hoy adivina
 * `errorMessage()` del renderer: `string`, `Error`, `{ data: { message } }`, `{ message }`, `{ name }`.
 * Devuelve `undefined` si no hay nada legible (el llamador pone su propio texto por `t()`).
 */
export function engineErrorText(err: unknown): string | undefined {
  if (err === undefined || err === null) return undefined
  if (typeof err === 'string') return err || undefined
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const o = err as { data?: { message?: unknown }; message?: unknown; name?: unknown }
    if (o.data && typeof o.data === 'object' && typeof o.data.message === 'string') return o.data.message
    if (typeof o.message === 'string') return o.message
    if (typeof o.name === 'string') return o.name
    try {
      return JSON.stringify(err)
    } catch {
      return undefined
    }
  }
  return String(err)
}

/** Convierte cualquier valor lanzado (red, abortos, cuerpos de error) en un `EngineError`. */
export function toEngineError(err: unknown, status?: number): EngineError {
  if (err instanceof EngineError) return err
  if (status !== undefined) {
    return new EngineError(kindFromStatus(status), engineErrorText(err) ?? `HTTP ${status}`, { status, detail: err })
  }
  if (err instanceof Error) {
    if (err.name === 'AbortError') return new EngineError('aborted', err.message, { detail: err })
    // `AbortSignal.timeout()` lanza TimeoutError: para quien llama es un fallo de red.
    return new EngineError('network', err.message, { detail: err })
  }
  return new EngineError('engine', engineErrorText(err) ?? 'unknown', { detail: err })
}
