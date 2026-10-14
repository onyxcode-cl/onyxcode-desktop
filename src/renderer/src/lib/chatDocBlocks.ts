/**
 * Detecta en el markdown de un mensaje los bloques que generan un documento: ```html (→ PDF, ya
 * existía) y los nuevos ```xlsx/```pptx/```docx (→ Excel/PowerPoint/Word vía datos estructurados). Los de datos
 * se extraen aparte (regex más simple, sin la heurística de "¿tiene pinta de HTML?" — el lenguaje de
 * la valla ya alcanza) y se MEZCLAN con los de `extractHtmlArtifacts` (sin tocarla: la sigue usando
 * Tareas/Code, que no conocen xlsx/pptx) ordenados por posición en el texto.
 */
import { parseLenient } from '@shared/json-lenient'
import { sanitizeDoc, sniffDocKind } from '@shared/chat-doc-sanitize'
import { isDocxSpec, isPptxSpec, isXlsxSpec, type DocxSpec, type PptxSpec, type XlsxSpec } from '@shared/chat-doc-spec'
import { extractHtmlArtifacts } from '../components/artifacts/ArtifactButton'

export type DataDocKind = 'xlsx' | 'pptx' | 'docx'

export type ChatDocBlock =
  | { kind: 'html'; index: number; title: string; rawText: string; isSlides: boolean }
  | { kind: 'xlsx'; index: number; title: string; rawText: string; data: XlsxSpec }
  | { kind: 'pptx'; index: number; title: string; rawText: string; data: PptxSpec }
  | { kind: 'docx'; index: number; title: string; rawText: string; data: DocxSpec }

/** Lenguajes de valla en los que un modelo suele pegar la spec cuando no usa el nombre del documento (se aceptan si el JSON es inequívoco). */
const JSON_LANGS = ['json', 'javascript', 'js', 'text', 'txt', 'plaintext']
export const isJsonLang = (lang: string | null | undefined): boolean => !!lang && JSON_LANGS.includes(lang.toLowerCase())

const DATA_FENCE = new RegExp(
  String.raw`(^|\n)[ \t]*(\x60\x60\x60+|~~~+)[ \t]*(xlsx|pptx|docx|${JSON_LANGS.join('|')})\b[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)`,
  'gi'
)

/** Por qué un bloque no se pudo usar: `json` (no es JSON ni con reparaciones) o `schema` (es JSON pero no tiene la forma del documento). */
export type DataBlockFailure = 'json' | 'schema'

export type DataBlockParse = { ok: true; data: XlsxSpec | PptxSpec | DocxSpec } | { ok: false; reason: DataBlockFailure }

/** Lee un bloque: JSON tolerante + limpieza de forma (claves de más, textos largos, números por texto…) + esquema estricto. Nunca lanza. */
export function parseDataBlockDetailed(kind: DataDocKind, rawText: string): DataBlockParse {
  let parsed: unknown
  try {
    parsed = parseLenient(rawText)
  } catch {
    return { ok: false, reason: 'json' }
  }
  const data = sanitizeDoc(kind, parsed)
  if (kind === 'xlsx') return isXlsxSpec(data) ? { ok: true, data } : { ok: false, reason: 'schema' }
  if (kind === 'docx') return isDocxSpec(data) ? { ok: true, data } : { ok: false, reason: 'schema' }
  return isPptxSpec(data) ? { ok: true, data } : { ok: false, reason: 'schema' }
}

/** `null` si `rawText` no es JSON válido o no cumple el schema del tipo — nunca lanza. */
export function parseDataBlock(kind: DataDocKind, rawText: string): XlsxSpec | PptxSpec | DocxSpec | null {
  const r = parseDataBlockDetailed(kind, rawText)
  return r.ok ? r.data : null
}

/** Para una valla genérica (```json…): el tipo de documento que describe su contenido, o `null` si no es (claramente) una spec. */
export function sniffDataKind(rawText: string): DataDocKind | null {
  try {
    return sniffDocKind(parseLenient(rawText))
  } catch {
    return null
  }
}

/** Mismo espíritu que `guessTitle` (HTML): un título corto a partir del contenido, o uno genérico. */
export function guessDataTitle(kind: 'xlsx' | 'pptx' | 'docx', rawText: string, n = 1): string {
  const data = parseDataBlock(kind, rawText)
  if (!data) return kind === 'xlsx' ? `Hoja de cálculo ${n}` : kind === 'docx' ? `Documento ${n}` : `Presentación ${n}`
  if (kind === 'docx') {
    const d = data as DocxSpec
    const heading = d.blocks.find((b) => b.type === 'heading')
    return d.title || (heading && heading.type === 'heading' ? heading.text : '') || `Documento ${n}`
  }
  if (kind === 'xlsx') return (data as XlsxSpec).sheets[0]?.name || `Hoja de cálculo ${n}`
  return (data as PptxSpec).slides[0]?.title || `Presentación ${n}`
}

/** Un bloque de datos CERRADO que no se pudo usar (para avisar en vez de ignorarlo en silencio). */
export interface BrokenDocBlock {
  kind: DataDocKind
  index: number
  rawText: string
  reason: DataBlockFailure
}

/** Recorre las vallas cerradas de datos: válidas → `blocks`; con JSON roto o forma incorrecta → `broken`. */
function scanDataFences(markdown: string): { blocks: Array<ChatDocBlock & { kind: DataDocKind }>; broken: BrokenDocBlock[] } {
  const blocks: Array<ChatDocBlock & { kind: DataDocKind }> = []
  const broken: BrokenDocBlock[] = []
  let m: RegExpExecArray | null
  DATA_FENCE.lastIndex = 0
  while ((m = DATA_FENCE.exec(markdown))) {
    const lang = m[3].toLowerCase()
    const rawText = m[4]
    if (!rawText.trim()) continue
    // ```json y compañía: solo cuenta si el contenido es, sin dudas, la spec de un documento (si no, es código normal).
    const kind: DataDocKind | null = isJsonLang(lang) ? sniffDataKind(rawText) : (lang as DataDocKind)
    if (!kind) continue
    const r = parseDataBlockDetailed(kind, rawText)
    if (!r.ok) {
      broken.push({ kind, index: m.index, rawText, reason: r.reason })
      continue
    }
    const title = guessDataTitle(kind, rawText, blocks.length + 1)
    blocks.push({ kind, index: m.index, rawText, data: r.data, title } as ChatDocBlock & { kind: DataDocKind })
  }
  return { blocks, broken }
}

/** Bloques ```xlsx/```pptx/```docx (o ```json con la spec) completos y bien formados. */
function extractDataArtifacts(markdown: string): Array<ChatDocBlock & { kind: DataDocKind }> {
  return scanDataFences(markdown).blocks
}

/** Bloques de datos cerrados pero inválidos (JSON roto o forma que no es la del documento). */
export function extractBrokenDocBlocks(markdown: string): BrokenDocBlock[] {
  return scanDataFences(markdown).broken
}

export function extractChatDocBlocks(markdown: string): ChatDocBlock[] {
  const html: ChatDocBlock[] = extractHtmlArtifacts(markdown).map((a) => ({
    kind: 'html',
    index: a.index,
    title: a.title,
    rawText: a.html,
    isSlides: a.isSlides
  }))
  const data: ChatDocBlock[] = extractDataArtifacts(markdown)
  return [...html, ...data].sort((a, b) => a.index - b.index)
}
