/**
 * Texto del detalle de una confirmación en el Mac (hallazgo 5 de la auditoría del remoto): lo que el celular manda es
 * texto NO confiable que el dueño lee para decidir. Se normaliza para que no pueda falsear líneas (saltos, caracteres de
 * control y de dirección), esconder los botones (tope de longitud y de líneas, con indicador de lo omitido) ni mostrar
 * secretos (patrones de `redact-patterns`). Funciones puras.
 */
import { maskSecretPatterns } from '@shared/redact-patterns'

export const DETAIL_MAX_LINES = 12
export const DETAIL_MAX_CHARS = 240

// Controles C0/C1, espacios de ancho cero, separadores de línea y marcas de dirección (pueden falsear lo que se lee).
const CONTROL_RE = new RegExp(
  '[' + ['\\u0000-\\u001f', '\\u007f-\\u009f', '\\u200b-\\u200f', '\\u2028-\\u202e', '\\u2066-\\u2069', '\\ufeff'].join('') + ']+',
  'g'
)

/** Una línea visible: sin saltos ni controles, sin secretos y como mucho `max` caracteres (con «…» si se cortó). */
export function cleanLine(v: unknown, max = DETAIL_MAX_CHARS): string {
  const s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v)
  const flat = maskSecretPatterns(s.replace(CONTROL_RE, ' '))
    .replace(/\s{2,}/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/** Líneas del detalle: limpias, sin vacías y con tope; lo que sobra se resume en «… (+N líneas)». */
export function cleanDetail(lines: readonly unknown[], maxLines = DETAIL_MAX_LINES, maxChars = DETAIL_MAX_CHARS): string[] {
  const all = lines.map((l) => cleanLine(l, maxChars)).filter((l) => l !== '')
  if (all.length <= maxLines) return all
  return [...all.slice(0, maxLines - 1), `… (+${all.length - (maxLines - 1)})`]
}

/** Vista previa de un texto largo (AGENTS.md, memoria, prompt): primeras líneas con contenido y el total de caracteres. */
export function previewText(v: unknown, maxLines = 5, maxChars = 160): string[] {
  if (typeof v !== 'string') return []
  const lines = v.split(/\r?\n/).filter((l) => l.trim() !== '')
  const shown = lines.slice(0, maxLines).map((l) => cleanLine(l, maxChars))
  const rest = lines.length - shown.length
  const clipped = lines.slice(0, maxLines).some((l) => cleanLine(l, 100_000).length > maxChars)
  if (rest > 0 || clipped) shown.push(`… (${v.length} car.)`)
  return shown
}
