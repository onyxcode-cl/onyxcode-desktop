/**
 * Detecta en el markdown de un mensaje los bloques que generan un documento: ```html (→ PDF, ya
 * existía) y los nuevos ```xlsx/```pptx (→ Excel/PowerPoint vía datos estructurados). Los de datos
 * se extraen aparte (regex más simple, sin la heurística de "¿tiene pinta de HTML?" — el lenguaje de
 * la valla ya alcanza) y se MEZCLAN con los de `extractHtmlArtifacts` (sin tocarla: la sigue usando
 * Tareas/Code, que no conocen xlsx/pptx) ordenados por posición en el texto.
 */
import { isPptxSpec, isXlsxSpec, type PptxSpec, type XlsxSpec } from '@shared/chat-doc-spec'
import { extractHtmlArtifacts } from '../components/artifacts/ArtifactButton'

export type ChatDocBlock =
  | { kind: 'html'; index: number; title: string; rawText: string; isSlides: boolean }
  | { kind: 'xlsx'; index: number; title: string; rawText: string; data: XlsxSpec }
  | { kind: 'pptx'; index: number; title: string; rawText: string; data: PptxSpec }

const DATA_FENCE = /(^|\n)[ \t]*(```+|~~~+)[ \t]*(xlsx|pptx)\b[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*(?=\n|$)/gi

/** `null` si `rawText` no es JSON válido o no cumple el schema del tipo — nunca lanza. */
export function parseDataBlock(kind: 'xlsx' | 'pptx', rawText: string): XlsxSpec | PptxSpec | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawText)
  } catch {
    return null
  }
  if (kind === 'xlsx') return isXlsxSpec(parsed) ? parsed : null
  return isPptxSpec(parsed) ? parsed : null
}

/** Mismo espíritu que `guessTitle` (HTML): un título corto a partir del contenido, o uno genérico. */
export function guessDataTitle(kind: 'xlsx' | 'pptx', rawText: string, n = 1): string {
  const data = parseDataBlock(kind, rawText)
  if (!data) return kind === 'xlsx' ? `Hoja de cálculo ${n}` : `Presentación ${n}`
  if (kind === 'xlsx') return (data as XlsxSpec).sheets[0]?.name || `Hoja de cálculo ${n}`
  return (data as PptxSpec).slides[0]?.title || `Presentación ${n}`
}

/** Extrae los bloques ```xlsx/```pptx completos y bien formados (ignora uno a medio escribir o con JSON inválido). */
function extractDataArtifacts(markdown: string): Array<ChatDocBlock & { kind: 'xlsx' | 'pptx' }> {
  const out: Array<ChatDocBlock & { kind: 'xlsx' | 'pptx' }> = []
  let m: RegExpExecArray | null
  DATA_FENCE.lastIndex = 0
  while ((m = DATA_FENCE.exec(markdown))) {
    const kind = m[3].toLowerCase() as 'xlsx' | 'pptx'
    const rawText = m[4]
    if (!rawText.trim()) continue
    const data = parseDataBlock(kind, rawText)
    if (!data) continue
    if (kind === 'xlsx' && isXlsxSpec(data))
      out.push({ kind, index: m.index, rawText, data, title: guessDataTitle(kind, rawText, out.length + 1) })
    else if (kind === 'pptx' && isPptxSpec(data))
      out.push({ kind, index: m.index, rawText, data, title: guessDataTitle(kind, rawText, out.length + 1) })
  }
  return out
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
