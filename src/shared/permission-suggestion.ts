/**
 * Sugerencia de permisos del motor (`metadata.lazunoxSugerencia`, motor `permission/sugerencia.ts`): `{ sugerencia, motivo }`.
 * Es TEXTO NO CONFIABLE (lo produce un modelo que lee contenido del proyecto, incluidos los patrones que escribe el agente) y solo
 * informa: nunca aprueba, preselecciona, reordena ni da foco a un botón. Aquí se lee de forma estricta y se limpia otra vez.
 */
import { isAutoApprovableCommand, isExecOrGitConfigPath } from './permission-rules'

export type PermissionSuggestionValue = 'permitir' | 'negar' | 'preguntar'
export type PermissionSuggestion = { value: PermissionSuggestionValue; reason: string }

export const SUGGESTION_REASON_MAX = 200

const VALUES: ReadonlySet<string> = new Set(['permitir', 'negar', 'preguntar'])

// Control (se vuelve espacio) y todo lo invisible o de formato (se borra, para que no parta palabras ni esquemas de enlace):
// \p{Cf} (incluye U+061C, U+180E, U+FFF9-FFFB y las etiquetas U+E0000-E007F), privados, sin asignar, separadores de línea/párrafo,
// selectores de variación, U+034F y los rellenos Hangul.
const CONTROL_RE = /[\p{Cc}\p{Zl}\p{Zp}]/gu
const INVISIBLE_RE = /[\p{Cf}\p{Co}\p{Cn}\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u034F\u115F\u1160\u3164\uFFA0]/gu

const TLDS =
  'com|net|org|io|dev|app|xyz|ru|cn|info|biz|co|me|sh|tk|top|site|online|club|cc|ly|to|ai|gg|zip|mov|link|click|live|store|cloud|pw|ws'

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
    // Esquemas sin «//» y dominios sin esquema (`algo.com/ruta`, `algo.io:8080`), también con punto ideográfico.
    .replace(/\b(?:javascript|data|mailto|vbscript|file|tel):\S*/gi, ' ')
    .replace(new RegExp(`\\S*[.。](?:${TLDS})\\b\\S*`, 'gi'), ' ')
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

/** El modelo pequeño del motor solo ve 5 patrones de 500 caracteres: si hay más, no vio todo lo que la persona aprueba. */
const MAX_PATTERNS = 5
const MAX_PATTERN_LEN = 500

const ENV_RE = /(^|[\\/])[^\\/]*\.env(\.[^\\/]*)?$/i

// Nombres que el motor protege (rutas-protegidas.ts) y configuración global del motor: se ocultan por nombre aunque falte la marca.
const SENSITIVE_SEGMENTS: ReadonlySet<string> = new Set(['.mcp.json', '.gitconfig', '.vscode', '.claude', '.idea', '.husky', '.opencode'])

/** Segmentos de una ruta tal como los vería Windows: sin espacios ni puntos finales, sin flujo `::$DATA`. */
function segmentsOf(path: string): string[] {
  return path
    .replace(/\\/g, '/')
    .split('/')
    .map((x) =>
      x
        .trim()
        .replace(/::?\$data$/i, '')
        .replace(/[. ]+$/, '')
        .toLowerCase()
    )
    .filter((x) => x && x !== '.')
}

/** ¿Ruta de configuración que se ejecuta, protegida por el motor o con forma de nombre corto 8.3? Ante la duda, sí. */
export function isSensitiveEditPath(path: string): boolean {
  const segs = segmentsOf(path)
  if (segs.some((x) => /~\d/.test(x) || SENSITIVE_SEGMENTS.has(x))) return true
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] === 'opencode' && (segs[i + 1] === 'config.json' || segs[i + 1].startsWith('plugin'))) return true
  }
  const norm = segs.join('/')
  return isExecOrGitConfigPath(norm) || isExecOrGitConfigPath('/' + norm)
}

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
  if (req.patterns.length > MAX_PATTERNS || req.patterns.some((p) => typeof p !== 'string' || p.length > MAX_PATTERN_LEN)) return true
  const paths = pathsOf(req)
  if (req.permission === 'edit' || req.permission === 'write') return paths.some((p) => isSensitiveEditPath(p))
  if (req.permission === 'read') return paths.some((p) => ENV_RE.test(p) || p.startsWith('mcp:'))
  return false
}

/**
 * «permitir» solo se acepta cuando es coherente con lo que se aprueba: en bash, si TODAS las órdenes (y `metadata.command`) son de solo
 * lectura según la app; nunca en webfetch/websearch (canal de salida de datos). Si no, se oculta; «negar» y «preguntar» no empujan a aprobar.
 */
function allowIsCoherent(req: SuggestionRequest): boolean {
  if (req.permission === 'webfetch' || req.permission === 'websearch') return false
  if (req.permission !== 'bash') return true
  const md = req.metadata as Record<string, unknown>
  const command = md.command
  if (command !== undefined && !isAutoApprovableCommand('auto', typeof command === 'string' ? command : undefined)) return false
  return req.patterns.length > 0 && req.patterns.every((p) => isAutoApprovableCommand('auto', p))
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
  if (sugerencia === 'permitir' && !allowIsCoherent(req)) return null
  return { value: sugerencia as PermissionSuggestionValue, reason }
}
