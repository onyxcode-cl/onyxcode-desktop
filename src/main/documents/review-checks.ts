/**
 * Chequeos automáticos de aspecto para `review.ts`, hechos sobre el XML del archivo (sin renderizar): elementos que se salen o se montan,
 * márgenes, letra mínima, contraste WCAG, restos de plantilla y referencias rotas de Excel. Cada función devuelve datos; `review.ts` decide
 * qué es ✘ (hay que corregirlo) y qué es ℹ (aviso). Lo que el XML no deja saber (colores de tema, texto que desborda su caja) NO se juzga.
 */
import { contrastRatio, requiredContrast } from './contrast'

/** Marcas de contenido que nadie quiso entregar. `TODO` va en mayúsculas para no confundirlo con la palabra «todo». */
const TEMPLATE_LEFTOVERS: Array<[RegExp, string]> = [
  [/lorem ipsum/i, 'lorem ipsum'],
  [/\bTODO\b/, 'TODO'],
  [/\bTBD\b/, 'TBD'],
  [/\[\s*(insert|insertar|aquí|aqui|nombre|empresa|fecha|título|titulo|texto|cliente)\b[^\]]{0,40}\]/i, '[insertar…]'],
  [/texto de (ejemplo|relleno)|placeholder text|your text here|escribe aquí|escriba aquí/i, 'texto de relleno'],
  [/haga clic para|haz clic para|click to (add|edit)/i, 'texto de plantilla'],
  [/\bx{3,}\b/i, 'xxx']
]

/** Restos de plantilla encontrados en un texto (sin repetir). */
export function templateLeftovers(text: string): string[] {
  const found: string[] = []
  for (const [re, name] of TEMPLATE_LEFTOVERS) if (re.test(text) && !found.includes(name)) found.push(name)
  return found
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Área de la intersección de dos cajas (0 si no se tocan). */
export function intersectionArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Pares de cajas que se montan más de `ratio` del área de la menor (0,35 = más de un tercio de la más chica). */
export function overlappingPairs(boxes: Box[], ratio = 0.35): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const small = Math.min(boxes[i].w * boxes[i].h, boxes[j].w * boxes[j].h)
      if (small > 0 && intersectionArea(boxes[i], boxes[j]) / small > ratio) out.push([i, j])
    }
  return out
}

export interface PptxRun {
  text: string
  /** Puntos, o `null` si el archivo no lo dice (hereda del tema). */
  sizePt: number | null
  bold: boolean
  color: string | null
}
export interface PptxTextShape {
  name: string
  box: Box | null
  placeholder: string | null
  /** Alineación del primer párrafo: `l`, `r`, `ctr` o `just` (`null` = la del tema, normalmente izquierda). */
  align: string | null
  /** Anclaje vertical del texto en su caja: `t`, `ctr` o `b` (`null` = arriba). */
  anchor: string | null
  fill: string | null
  runs: PptxRun[]
}

const attr = (s: string, name: string): string | undefined => new RegExp(`\\s${name}="([^"]*)"`).exec(s)?.[1]
const unesc = (s: string): string =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')

/** Color hex explícito de un `<a:solidFill>` al principio de `xml` (el primero que aparezca), o `null` (tema, degradado, nada). */
function solidHex(xml: string): string | null {
  const m = /<a:solidFill>\s*<a:srgbClr val="([0-9a-fA-F]{6})"/.exec(xml)
  return m ? m[1].toUpperCase() : null
}

/** Formas con texto de una diapositiva, con su caja, relleno propio y tramos de letra (tamaño, negrita, color explícito). */
export function pptxTextShapes(slideXml: string): PptxTextShape[] {
  const out: PptxTextShape[] = []
  for (const sp of slideXml.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []) {
    const runs: PptxRun[] = []
    for (const r of sp.match(/<a:r>[\s\S]*?<\/a:r>/g) ?? []) {
      const text = unesc([...r.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(''))
      if (!text.trim()) continue
      const rPr = /<a:rPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:rPr>)/.exec(r)?.[0] ?? ''
      const sz = attr(rPr.slice(0, rPr.indexOf('>') + 1), 'sz')
      runs.push({
        text,
        sizePt: sz ? Number(sz) / 100 : null,
        bold: attr(rPr.slice(0, rPr.indexOf('>') + 1), 'b') === '1',
        color: solidHex(rPr)
      })
    }
    if (!runs.length) continue
    const spPr = /<p:spPr>[\s\S]*?<\/p:spPr>/.exec(sp)?.[0] ?? ''
    const geom = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(spPr)
    const [x, y, w, h] = geom ? geom.slice(1).map(Number) : [0, 0, 0, 0]
    out.push({
      name: attr(/<p:cNvPr\b[^>]*>/.exec(sp)?.[0] ?? '', 'name') ?? 'forma',
      box: geom ? { x, y, w, h } : null,
      placeholder: /<p:ph\b[^>]*?\stype="([^"]+)"/.exec(sp)?.[1] ?? null,
      align: /<a:pPr\b[^>]*?\salgn="([^"]+)"/.exec(sp)?.[1] ?? null,
      anchor: /<a:bodyPr\b[^>]*?\sanchor="([^"]+)"/.exec(sp)?.[1] ?? null,
      // Relleno propio de la forma: lo que va en spPr ANTES del contorno (`<a:ln>`).
      fill: solidHex(spPr.split('<a:ln')[0]),
      runs
    })
  }
  return out
}

/** Fondo sólido explícito de una diapositiva, un diseño o un patrón (`<p:bg>`), o `null` si no se sabe. */
export function pptxBackground(xml: string): string | null {
  const bg = /<p:bg>[\s\S]*?<\/p:bg>/.exec(xml)?.[0]
  return bg ? solidHex(bg) : null
}

export interface ContrastProblem {
  where: string
  ratio: number
  need: number
}

/** Tramos de texto con color explícito cuyo contraste contra su fondo conocido no llega al mínimo WCAG. */
export function pptxContrastProblems(shapes: PptxTextShape[], slideBg: string | null, slideLabel: string): ContrastProblem[] {
  const out: ContrastProblem[] = []
  for (const s of shapes) {
    const bg = s.fill ?? slideBg
    for (const r of s.runs) {
      if (!r.color) continue
      const ratio = contrastRatio(r.color, bg)
      if (ratio == null) continue
      const need = requiredContrast(r.sizePt, r.bold)
      if (ratio < need) out.push({ where: `${slideLabel} («${r.text.trim().slice(0, 24)}»)`, ratio, need })
    }
  }
  return out
}

/** Contraste de los tramos de Word con color explícito: contra el sombreado de su celda o párrafo, o contra el blanco de la página. */
export function docxContrastProblems(documentXml: string): ContrastProblem[] {
  const out: ContrastProblem[] = []
  const scan = (xml: string, bg: string | null): void => {
    for (const r of xml.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []) {
      const color = /<w:color w:val="([0-9a-fA-F]{6})"/.exec(r)?.[1]
      if (!color) continue
      const text = unesc([...r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''))
      if (!text.trim()) continue
      const half = /<w:sz w:val="(\d+)"/.exec(r)?.[1]
      const sizePt = half ? Number(half) / 2 : null
      const shd = /<w:shd\b[^>]*w:fill="([0-9a-fA-F]{6})"/.exec(r)?.[1]
      const ratio = contrastRatio(color, shd ?? bg ?? 'FFFFFF')
      if (ratio == null) continue
      const need = requiredContrast(sizePt, /<w:b\/>|<w:b w:val="(1|true)"/.test(r))
      if (ratio < need) out.push({ where: `«${text.trim().slice(0, 24)}»`, ratio, need })
    }
  }
  let rest = documentXml
  for (const tc of documentXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []) {
    const fill = /<w:tcPr>[\s\S]*?<w:shd\b[^>]*w:fill="([0-9a-fA-F]{6})"/.exec(tc)?.[1] ?? null
    scan(tc, fill)
    rest = rest.replace(tc, '')
  }
  scan(rest, null)
  return out
}

/** Tamaños de letra de Word en puntos (media punto en el XML) con su texto, para encontrar letra demasiado chica. */
export function docxSmallRuns(documentXml: string, belowPt: number): Array<{ text: string; sizePt: number }> {
  const out: Array<{ text: string; sizePt: number }> = []
  for (const r of documentXml.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []) {
    const half = /<w:sz w:val="(\d+)"/.exec(r)?.[1]
    if (!half) continue
    const sizePt = Number(half) / 2
    if (sizePt >= belowPt) continue
    const text = unesc([...r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''))
    if (text.trim()) out.push({ text: text.trim().slice(0, 24), sizePt })
  }
  return out
}

/** Hojas a las que apunta una fórmula de Excel (`Hoja2!A1`, `'Ventas 2026'!B3`). */
export function formulaSheetRefs(formula: string): string[] {
  const out: string[] = []
  const noStrings = formula.replace(/"(?:[^"]|"")*"/g, '""')
  for (const m of noStrings.matchAll(/(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!/g)) out.push((m[1] ?? m[2]).replace(/''/g, "'"))
  return out
}

/**
 * ¿El TEXTO (no la caja entera) queda a menos de `edge` del borde de la lámina? La caja puede llegar al borde sin que el texto lo haga:
 * un texto alineado a la izquierda solo se acerca al borde izquierdo, uno a la derecha solo al derecho, y uno centrado o anclado al
 * medio no se mide (no se sabe dónde cae). Sin la forma del texto real, solo se avisa cuando el lado medible lo justifica.
 */
export function textNearEdge(
  shape: Pick<PptxTextShape, 'box' | 'align' | 'anchor'>,
  slideW: number,
  slideH: number,
  edge: number
): boolean {
  const b = shape.box
  if (!b) return false
  const align = shape.align ?? 'l'
  const anchor = shape.anchor ?? 't'
  const left = (align === 'l' || align === 'just') && b.x < edge
  const right = (align === 'r' || align === 'just') && b.x + b.w > slideW - edge
  const top = anchor === 't' && b.y < edge
  const bottom = anchor === 'b' && b.y + b.h > slideH - edge
  return left || right || top || bottom
}
