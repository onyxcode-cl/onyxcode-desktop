/**
 * Sugerencia de permisos del motor (`metadata.lazunoxSugerencia`, motor `permission/sugerencia.ts`): `{ sugerencia, motivo }`.
 * Es TEXTO NO CONFIABLE (lo produce un modelo que lee contenido del proyecto, incluidos los patrones que escribe el agente) y solo
 * informa: nunca aprueba, preselecciona, reordena ni da foco a un botón. Aquí se lee de forma estricta y se limpia otra vez.
 */
import { isExecOrGitConfigPath } from './permission-rules'

export type PermissionSuggestionValue = 'permitir' | 'negar' | 'preguntar'
export type PermissionSuggestion = { value: PermissionSuggestionValue; reason: string }

export const SUGGESTION_REASON_MAX = 200

const VALUES: ReadonlySet<string> = new Set(['permitir', 'negar', 'preguntar'])

// Control (se vuelve espacio) y todo lo invisible o de formato (se borra, para que no parta palabras ni esquemas de enlace):
// \p{Cf} (incluye U+061C, U+180E, U+FFF9-FFFB y las etiquetas U+E0000-E007F), privados, sin asignar, separadores de línea/párrafo,
// selectores de variación, U+034F y los rellenos Hangul.
const CONTROL_RE = /[\p{Cc}\p{Zl}\p{Zp}]/gu
const INVISIBLE_RE = /[\p{Cf}\p{Co}\p{Cn}\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u034F\u115F\u1160\u3164\uFFA0]/gu

/** Una línea de texto plano: sin control, sin marcas de dirección, sin enlaces, sin Markdown ni etiquetas, con tope por puntos de código. */
export function cleanSuggestionReason(text: unknown): string {
  if (typeof text !== 'string') return ''
  const limpio = text
    .normalize('NFKC')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(CONTROL_RE, ' ')
    .replace(INVISIBLE_RE, '')
    .replace(/<[^>]*>/g, ' ')
    // Primero los signos de Markdown, después los enlaces: así un enlace partido con ()[] ya no se vuelve a juntar.
    .replace(/[`*_~#>\[\]()<>{}|\\]/g, '')
    .replace(/\S*:\/\/\S*/g, ' ')
    .replace(/\bwww\.\S*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return Array.from(limpio).slice(0, SUGGESTION_REASON_MAX).join('').trim()
}

export type SuggestionRequest = {
  permission: string
  patterns: readonly string[]
  metadata: unknown
  api?: string
}
export type SuggestionOptions = {
  /** Marca `lazunoxProtegido` del motor (ya calculada por la tarjeta). */
  protectedPath?: boolean
  /** La petición viene de un ayudante (sesión hija). */
  isChild?: boolean
}

// Solo estas acciones pueden llevar sugerencia; todo lo demás (external_directory, conectores MCP, task, documentos…) la oculta.
const SUGGESTIBLE: ReadonlySet<string> = new Set(['bash', 'webfetch', 'websearch', 'edit', 'write', 'read'])

const ENV_RE = /(^|[\\/])[^\\/]*\.env(\.[^\\/]*)?$/i

function pathsOf(req: SuggestionRequest): string[] {
  const out = [...req.patterns]
  const md =
    req.metadata && typeof req.metadata === 'object' && !Array.isArray(req.metadata) ? (req.metadata as Record<string, unknown>) : {}
  for (const k of ['filepath', 'filePath']) if (typeof md[k] === 'string') out.push(md[k] as string)
  return out.filter((p): p is string => typeof p === 'string')
}

/** ¿Hay que ocultar la sugerencia por la naturaleza de la petición? Ante la duda, sí. */
export function suggestionHiddenFor(req: SuggestionRequest, opts: SuggestionOptions = {}): boolean {
  if (opts.protectedPath || opts.isChild) return true
  if (req.api !== 'v1') return true // en v2 el motor no descarta una clave puesta por la herramienta
  if (!SUGGESTIBLE.has(req.permission)) return true
  const paths = pathsOf(req)
  if (req.permission === 'edit' || req.permission === 'write') return paths.some((p) => isExecOrGitConfigPath(p))
  if (req.permission === 'read') return paths.some((p) => ENV_RE.test(p) || p.startsWith('mcp:'))
  return false
}

/**
 * Lee la sugerencia de la petición. Devuelve `null` si no hay, si no es válida, si el motivo queda vacío tras limpiarlo o si la
 * petición es de las que la ocultan (ruta protegida, configuración que se ejecuta, `.env`, fuera del proyecto, ayudantes, conectores, v2).
 */
export function readPermissionSuggestion(req: SuggestionRequest, opts: SuggestionOptions = {}): PermissionSuggestion | null {
  if (suggestionHiddenFor(req, opts)) return null
  const metadata = req.metadata
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null
  const raw = (metadata as Record<string, unknown>).lazunoxSugerencia
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const { sugerencia, motivo } = raw as Record<string, unknown>
  if (typeof sugerencia !== 'string' || !VALUES.has(sugerencia)) return null
  const reason = cleanSuggestionReason(motivo)
  if (!reason) return null
  return { value: sugerencia as PermissionSuggestionValue, reason }
}
