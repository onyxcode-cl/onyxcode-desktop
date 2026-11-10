/**
 * Valoración de una respuesta («buena» / «mala»). Se guarda SOLO en el equipo (`userData/logs/valoraciones.jsonl`): nunca sale por red
 * y nunca lleva el texto de la conversación ni rutas de archivos.
 */
export const RATING_VALUES = ['good', 'bad'] as const
export type RatingValue = (typeof RATING_VALUES)[number]

export const RATING_COMMENT_MAX = 280
/** Tope de valoraciones guardadas (las más antiguas se descartan). */
export const RATING_MAX_RECORDS = 5000
export const RATING_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/
export const RATING_LABEL_RE = /^[\w.:/@+ -]{1,128}$/
export const RATING_FILE = 'valoraciones.jsonl'

export interface RatingTokens {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

/** Lo que manda la ventana. `value: null` = quitar la valoración. */
export interface RatingInput {
  sessionId: string
  messageId: string
  value: RatingValue | null
  comment?: string
  /** Modelo y servicio con que se respondió (ids, no nombres de la persona). */
  model: string
  service: string
  mode: string
  durationMs?: number
  tokens?: RatingTokens
}

/** Lo que la ventana recupera para pintar el estado. */
export interface RatingEntry {
  messageId: string
  value: RatingValue
  comment?: string
}

/** Una línea del archivo. */
export interface RatingRecord {
  t: string
  sessionId: string
  messageId: string
  model: string
  service: string
  mode: string
  appVersion: string
  engineVersion: string
  value: RatingValue
  comment?: string
  durationMs?: number
  tokens?: RatingTokens
}
