/**
 * Sugerencia de permisos del motor (`metadata.lazunoxSugerencia`, motor `permission/sugerencia.ts`): `{ sugerencia, motivo }`.
 * Es TEXTO NO CONFIABLE (lo produce un modelo que lee contenido del proyecto) y solo informa: nunca aprueba, preselecciona,
 * reordena ni da foco a un botón. Aquí se lee de forma estricta y se limpia otra vez, aunque el motor ya lo hace.
 */

export type PermissionSuggestionValue = 'permitir' | 'negar' | 'preguntar'
export type PermissionSuggestion = { value: PermissionSuggestionValue; reason: string }

export const SUGGESTION_REASON_MAX = 200

const VALUES: ReadonlySet<string> = new Set(['permitir', 'negar', 'preguntar'])

/** Una línea de texto plano: sin control, sin marcas de dirección, sin enlaces, sin Markdown ni etiquetas, con tope. */
export function cleanSuggestionReason(text: unknown): string {
  if (typeof text !== 'string') return ''
  return text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?:https?|ftp|file):\/\/\S*/gi, ' ')
    .replace(/\bwww\.\S*/gi, ' ')
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/[`*_~#>\[\]()<>{}|\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUGGESTION_REASON_MAX)
    .trim()
}

/**
 * Lee la sugerencia de la metadata de una petición. Devuelve `null` si no hay, si no es válida, si la petición es de ruta
 * protegida (`protectedPath`) o si el motivo queda vacío tras limpiarlo: ahí la tarjeta se ve igual que sin sugerencia.
 */
export function readPermissionSuggestion(metadata: unknown, protectedPath = false): PermissionSuggestion | null {
  if (protectedPath) return null
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const raw = (metadata as Record<string, unknown>).lazunoxSugerencia
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { sugerencia, motivo } = raw as Record<string, unknown>
  if (typeof sugerencia !== 'string' || !VALUES.has(sugerencia)) return null
  const reason = cleanSuggestionReason(motivo)
  if (!reason) return null
  return { value: sugerencia as PermissionSuggestionValue, reason }
}
