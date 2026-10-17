/**
 * Detector de archivos que la IA crea o menciona en una respuesta del Chat. Función pura: devuelve rutas CANDIDATAS
 * (absolutas, sin repetidos); main decide cuáles existen, están en una carpeta permitida y qué se puede hacer con cada una
 * (`extras:chatFile:info`). El texto del modelo es un dato no confiable: aquí solo se propone, nunca se autoriza nada.
 * Funciona con cualquier herramienta o MCP: mira las rutas de las entradas y salidas de TODAS las herramientas, no de una en concreto.
 */
import type { Part } from '@opencode-ai/sdk/v2/client'

const EXT =
  'png|jpe?g|gif|webp|bmp|avif|svg|pdf|docx?|xlsx?|xlsm|pptx?|odt|ods|odp|rtf|html?|md|markdown|txt|log|csv|tsv|json|ya?ml|toml|xml|js|mjs|ts|tsx|jsx|css|sql|py|sh|bat|cmd|ps1|command|exe'
/** Ruta absoluta (posix o con unidad de Windows) que termina en una extensión conocida; admite espacios y acentos. */
const ABS_RE = new RegExp(`(?:(?<![\\w/.~:-])\\/|(?<![\\w])[A-Za-z]:[\\\\/])[^\\n"'\`<>|*?]{0,300}?\\.(?:${EXT})(?![\\w])`, 'gi')
const EXT_AT_END = new RegExp(`\\.(?:${EXT})$`, 'i')

const isAbs = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)

/** Normaliza `.` y `..` y las barras repetidas (sin tocar el disco). */
export function normalizeAbs(p: string): string {
  const win = /^[A-Za-z]:/.test(p)
  const sep = win ? '\\' : '/'
  const drive = win ? p.slice(0, 2) : ''
  const out: string[] = []
  for (const s of (win ? p.slice(2) : p).split(/[\\/]+/)) {
    if (!s || s === '.') continue
    if (s === '..') out.pop()
    else out.push(s)
  }
  return drive + sep + out.join(sep)
}

function resolveCandidate(raw: string, root: string | null): string | null {
  const clean = raw.trim().replace(/^file:\/\//, '')
  if (!clean || clean.includes('\0') || !EXT_AT_END.test(clean)) return null
  if (isAbs(clean)) return normalizeAbs(clean)
  if (!root || clean.startsWith('~') || /^[a-z]+:\/\//i.test(clean)) return null
  return normalizeAbs(`${root}/${clean}`)
}

/** Cadenas de un valor JSON (hasta cierta profundidad), para mirar las entradas de cualquier herramienta. */
function stringsOf(v: unknown, out: string[], depth = 0): void {
  if (out.length > 200 || depth > 4) return
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v.slice(0, 50)) stringsOf(x, out, depth + 1)
  else if (v && typeof v === 'object')
    for (const x of Object.values(v as Record<string, unknown>).slice(0, 50)) stringsOf(x, out, depth + 1)
}

const MAX_CANDIDATES = 40

export interface ChatFileScanInput {
  /** Partes de la respuesta del asistente, en orden. */
  parts: readonly Part[]
  /** Carpeta de trabajo del chat, para resolver rutas relativas que entrega una herramienta (`null` si no se conoce). */
  root: string | null
}

/** Rutas absolutas candidatas a archivo creado o mencionado, sin repetidos y en orden de aparición. */
export function detectChatFiles({ parts, root }: ChatFileScanInput): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  const add = (raw: string, allowRelative: boolean): void => {
    if (found.length >= MAX_CANDIDATES) return
    const abs = resolveCandidate(raw, allowRelative ? root : null)
    if (!abs || seen.has(abs)) return
    seen.add(abs)
    found.push(abs)
  }
  const scan = (text: string): void => {
    for (const m of text.matchAll(ABS_RE)) add(m[0], false)
  }
  for (const p of parts) {
    if (p.type === 'text') {
      if (!p.synthetic && !p.ignored) scan(p.text)
      continue
    }
    if (p.type !== 'tool' || p.state.status !== 'completed') continue
    const strings: string[] = []
    stringsOf(p.state.input, strings)
    // Un valor que ES una ruta (campo `path`, `filePath`, `output_path`…) puede ser relativo a la carpeta del chat.
    for (const s of strings) {
      if (s.length <= 400 && !s.includes('\n')) add(s, true)
      scan(s)
    }
    if (typeof p.state.output === 'string') scan(p.state.output)
  }
  return found
}
