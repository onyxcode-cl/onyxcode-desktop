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
  [/\bTBC\b/, 'TBC'],
  [/\bto be (confirmed|determined|defined)\b/i, 'to be…'],
  [/\[\s*(logo|firma|imagen)\b[^\]]{0,40}\]/i, '[logo/firma/imagen]'],
  [/\[\s*(insert|insertar|aquí|aqui|nombre|empresa|fecha|título|titulo|texto|cliente)\b[^\]]{0,40}\]/i, '[insertar…]'],
  [/\[\s*(pendiente|por definir|por completar|completar|a confirmar|sin dato|falta dato|dato faltante|n\/d)\b/i, '[PENDIENTE…]'],
  [/\[\s*(\.{3}|…)\s*\]/, '[…]'],
  [/\b(a|por) (definir|determinar|confirmar|validar|revisar|estimar)\b|\ben revisi[oó]n\b/i, '«a definir»'],
  [
    /\ben evaluaci[oó]n\b|\bsujet[oa]s? a (confirmaci[oó]n|definici[oó]n|aprobaci[oó]n de (finanzas|presupuesto))\b|\bmontos? (por|a) (confirmar|definir|estimar)\b/i,
    '«en evaluación»'
  ],
  [/^\s*(pendiente|n\/d|s\/d|n\.d\.|tbd)\s*$/im, 'celda «pendiente»'],
  [/texto de (ejemplo|relleno)|placeholder text|your text here|escribe aquí|escriba aquí/i, 'texto de relleno'],
  [/haga clic para|haz clic para|click to (add|edit)/i, 'texto de plantilla'],
  [/\bx{3,}\b/i, 'xxx']
]

/**
 * Una celda que es solo «N/A» (sin nada más): resto de plantilla en una hoja de cálculo. Se mira celda por celda, porque dentro de un texto
 * corrido «N/A» puede ser legítimo («N/A del sistema»).
 */
export function isNaCell(text: string): boolean {
  return /^\s*n\/a\s*$/i.test(text)
}

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
  /** Posición de la forma en el XML (orden de apilado: más grande = más arriba). */
  pos?: number
  runs: PptxRun[]
}

/** Forma con relleno sólido (panel, tarjeta, franja) que puede quedar detrás de un texto. */
export interface PptxPanel {
  box: Box
  fill: string
  pos: number
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
  for (const m of slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const sp = m[0]
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
      pos: m.index ?? 0,
      runs
    })
  }
  return out
}

/** Formas con relleno sólido y caja conocida (paneles, tarjetas, franjas), en orden de apilado. Sirven de fondo real de los textos que quedan encima. */
export function pptxPanels(slideXml: string): PptxPanel[] {
  const out: PptxPanel[] = []
  for (const m of slideXml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const spPr = /<p:spPr>[\s\S]*?<\/p:spPr>/.exec(m[0])?.[0] ?? ''
    const geom = /<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/.exec(spPr)
    const fill = solidHex(spPr.split('<a:ln')[0])
    if (!geom || !fill) continue
    const [x, y, w, h] = geom.slice(1).map(Number)
    out.push({ box: { x, y, w, h }, fill, pos: m.index ?? 0 })
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
export function pptxContrastProblems(
  shapes: PptxTextShape[],
  slideBg: string | null,
  slideLabel: string,
  panels: PptxPanel[] = []
): ContrastProblem[] {
  const out: ContrastProblem[] = []
  for (const s of shapes) {
    // Fondo real: el relleno propio; si no, el panel más alto en el apilado que contiene el centro del texto (p. ej. texto claro
    // sobre una tarjeta oscura); si no, el fondo de la diapositiva.
    let behind: string | null = null
    if (!s.fill && s.box) {
      const cx = s.box.x + s.box.w / 2
      const cy = s.box.y + s.box.h / 2
      for (const p of panels) {
        if (p.pos >= (s.pos ?? 0)) break
        if (cx >= p.box.x && cx <= p.box.x + p.box.w && cy >= p.box.y && cy <= p.box.y + p.box.h) behind = p.fill
      }
    }
    const bg = s.fill ?? behind ?? slideBg
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
  const shading = (props: string): string | null => /<w:shd\b[^>]*w:fill="([0-9a-fA-F]{6})"/.exec(props)?.[1] ?? null
  const scanRuns = (xml: string, bg: string | null): void => {
    for (const r of xml.match(/<w:r>[\s\S]*?<\/w:r>/g) ?? []) {
      const color = /<w:color w:val="([0-9a-fA-F]{6})"/.exec(r)?.[1]
      if (!color) continue
      const text = unesc([...r.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map((m) => m[1]).join(''))
      if (!text.trim()) continue
      const half = /<w:sz w:val="(\d+)"/.exec(r)?.[1]
      const sizePt = half ? Number(half) / 2 : null
      const shd = shading(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/.exec(r)?.[0] ?? '')
      const ratio = contrastRatio(color, shd ?? bg ?? 'FFFFFF')
      if (ratio == null) continue
      const need = requiredContrast(sizePt, /<w:b\/>|<w:b w:val="(1|true)"/.test(r))
      if (ratio < need) out.push({ where: `«${text.trim().slice(0, 24)}»`, ratio, need })
    }
  }
  const scan = (xml: string, bg: string | null): void => {
    let rest = xml
    for (const paragraph of xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []) {
      // Solo propiedades del párrafo: un sombreado del primer tramo no es el fondo de los demás.
      const props = /<w:pPr\b[^>]*>[\s\S]*?<\/w:pPr>/.exec(paragraph)?.[0] ?? ''
      const ownFill = shading(props.replace(/<w:rPr\b[^>]*>[\s\S]*?<\/w:rPr>/g, ''))
      scanRuns(paragraph, ownFill ?? bg)
      rest = rest.replace(paragraph, '')
    }
    scanRuns(rest, bg)
  }
  let rest = documentXml
  for (const tc of documentXml.match(/<w:tc>[\s\S]*?<\/w:tc>/g) ?? []) {
    const fill = shading(/<w:tcPr\b[^>]*>[\s\S]*?<\/w:tcPr>/.exec(tc)?.[0] ?? '')
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

/**
 * Caja que ocupa el TEXTO (no la caja entera): se estima cuántas líneas ocupa con el ancho de la caja y el tamaño de letra, y se
 * achica la altura hacia donde está anclado el texto (arriba, centro o abajo). Solo achica, nunca agranda; sin tamaño de letra
 * conocido devuelve la caja tal cual. Sirve para no avisar «textos montados» cuando solo se tocan las cajas, no las letras.
 */
export function textExtentBox(shape: Pick<PptxTextShape, 'box' | 'anchor' | 'runs'>): Box | null {
  const b = shape.box
  if (!b) return null
  const sizes = shape.runs.map((r) => r.sizePt).filter((n): n is number => n != null)
  if (!sizes.length || b.w <= 0) return b
  const size = Math.max(...sizes)
  const chars = shape.runs.reduce((n, r) => n + r.text.length, 0)
  const boxWidthPt = b.w / 12700
  const lines = Math.max(1, Math.ceil((chars * size * 0.55) / boxWidthPt))
  const h = Math.min(b.h, Math.round((lines * size * 1.2 + 7.2) * 12700))
  const anchor = shape.anchor ?? 't'
  const y = anchor === 'b' ? b.y + b.h - h : anchor === 'ctr' ? b.y + (b.h - h) / 2 : b.y
  return { x: b.x, y, w: b.w, h }
}

/** Palabras de un título que anuncian cifras (presupuesto, inversión, costos, precios, tarifas, cotización). */
const MONEY_TOPIC = /presupuesto|inversi[oó]n|costos?\b|precios?\b|tarifas?\b|cotizaci[oó]n|financiamiento|retorno|roi\b/i

/** Láminas (pptx) o tablas (docx) sobre dinero sin un solo dígito: el modelo quitó las cifras en vez de poner valores de ejemplo. */
export function moneyWithoutNumbers(kind: 'pptx' | 'docx', spec: unknown): string[] {
  const out: string[] = []
  const texts = (v: unknown, acc: string[] = []): string[] => {
    if (typeof v === 'string') acc.push(v)
    else if (typeof v === 'number') acc.push(String(v))
    else if (Array.isArray(v)) v.forEach((x) => texts(x, acc))
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => texts(x, acc))
    return acc
  }
  const s = spec as { slides?: Array<Record<string, unknown>>; blocks?: Array<Record<string, unknown>> }
  if (kind === 'pptx') {
    for (const [i, sl] of (s.slides ?? []).entries()) {
      const title = typeof sl.title === 'string' ? sl.title : ''
      if (MONEY_TOPIC.test(title) && sl.layout !== 'timeline' && texts({ ...sl, title: '' }).filter((t) => /\d/.test(t)).length < 3)
        out.push(`lámina ${i + 1} «${title.slice(0, 40)}»`)
    }
  } else {
    for (const [i, b] of (s.blocks ?? []).entries()) {
      if (b.type !== 'table') continue
      const cols = texts(b.columns).join(' ')
      if (MONEY_TOPIC.test(cols) && !/\d/.test(texts(b.rows).join(' '))) out.push(`tabla del bloque ${i + 1}`)
    }
  }
  return out
}

/**
 * Detección POR ESTRUCTURA de cifras que faltan: en una columna donde la mayoría de las celdas trae números, una celda de texto corto sin
 * dígito («Por validar», «En revisión», «Pendiente»…) es una cifra que se esquivó con otras palabras. Sirve para cualquier sinónimo.
 */
export function gapCells(columns: unknown[], rows: unknown[][]): string[] {
  const out: string[] = []
  const numeric = (v: unknown): boolean =>
    typeof v === 'number' || (typeof v === 'string' && /\d/.test(v)) || (!!v && typeof v === 'object')
  const gap = (v: unknown): boolean =>
    typeof v === 'string' &&
    v.trim().length > 0 &&
    v.trim().length <= 28 &&
    !/\d/.test(v) &&
    !/^[\s—–-]+$/.test(v) &&
    v.trim().split(/\s+/).length <= 4
  const cols = Math.max(columns.length, ...rows.map((r) => r.length))
  for (let c = 1; c < cols; c++) {
    const cells = rows.map((r) => r[c])
    const nums = cells.filter(numeric).length
    const gaps = cells.filter(gap)
    if (gaps.length > 0 && nums >= 2 && nums > gaps.length)
      out.push(`«${String(gaps[0]).trim()}» en la columna ${String(columns[c] ?? c + 1)}`)
  }
  return out
}

/** Tablas de un spec (pptx: `slides[].table`, docx: bloques `table`, xlsx: filas de cada hoja) con celdas de texto donde van cifras. */
export function specGapCells(kind: 'pptx' | 'docx' | 'xlsx', spec: unknown): string[] {
  const s = spec as {
    slides?: Array<{ table?: { columns?: unknown[]; rows?: unknown[][] } }>
    blocks?: Array<Record<string, unknown>>
    sheets?: Array<{ rows?: unknown[][] }>
  }
  const found: string[] = []
  const run = (cols: unknown[], rows: unknown[][], where: string): void => {
    for (const g of gapCells(cols, rows)) found.push(`${where}: ${g}`)
  }
  const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : [])
  if (kind === 'pptx')
    arr(s.slides).forEach(
      (sl, i) => sl?.table && Array.isArray(sl.table.rows) && run(sl.table.columns ?? [], sl.table.rows, `lámina ${i + 1}`)
    )
  else if (kind === 'docx')
    arr(s.blocks).forEach(
      (b, i) =>
        b &&
        b.type === 'table' &&
        Array.isArray(b.rows) &&
        run((b.columns as unknown[]) ?? [], b.rows as unknown[][], `tabla del bloque ${i + 1}`)
    )
  else
    arr(s.sheets).forEach(
      (sh, i) => sh && Array.isArray(sh.rows) && sh.rows.length > 1 && run(sh.rows[0] ?? [], sh.rows.slice(1), `hoja ${i + 1}`)
    )
  return found
}

/**
 * Saltos en la jerarquía de encabezados de Word: un nivel 3 justo después de un 1 (sin un 2 en medio) deja el índice y el panel de
 * navegación con huecos. `levels` son los niveles de los encabezados en orden; devuelve el índice de cada encabezado que salta.
 */
export function headingJumps(levels: number[]): number[] {
  const out: number[] = []
  for (let i = 1; i < levels.length; i++) if (levels[i] - levels[i - 1] > 1) out.push(i)
  return out
}

/**
 * Longitud de cada tramo de ítems seguidos con el mismo `numId` de lista (`null` = párrafo que no es ítem: corta el tramo). Sirve para
 * avisar de listas demasiado largas, que cansan y suelen pedir una tabla o dos listas.
 */
export function listRuns(numIds: Array<string | null>): number[] {
  const lengths: number[] = []
  let cur = 0
  numIds.forEach((id, i) => {
    if (id && id === numIds[i - 1]) cur++
    else {
      if (cur) lengths.push(cur)
      cur = id ? 1 : 0
    }
  })
  if (cur) lengths.push(cur)
  return lengths
}

/**
 * Títulos de diapositiva repetidos (mismo texto en 2 o más, sin distinguir mayúsculas) y títulos que terminan en punto. `titles[i]` es
 * el título de la diapositiva i, o `null` si no tiene. Devuelve los textos tal como están en la primera diapositiva que los trae.
 */
export function slideTitleIssues(titles: Array<string | null>): { repeated: string[]; dotted: string[] } {
  const count = new Map<string, { text: string; n: number }>()
  for (const t of titles) {
    const text = t?.trim()
    if (!text) continue
    const key = text.toLowerCase()
    const entry = count.get(key)
    if (entry) entry.n++
    else count.set(key, { text, n: 1 })
  }
  return {
    repeated: [...count.values()].filter((e) => e.n >= 2).map((e) => e.text),
    dotted: [...count.values()].filter((e) => /\.$/.test(e.text)).map((e) => e.text)
  }
}

/**
 * ¿Toda la presentación son viñetas? Con 4 o más láminas de contenido (sin contar la portada, `layouts[0]`) y todas con diseño ausente o
 * `bullets`, el lector ve una pared de viñetas: conviene variar el tipo de lámina.
 */
export function monotonousLayouts(layouts: Array<string | undefined>): boolean {
  const content = layouts.slice(1)
  return content.length >= 4 && content.every((l) => l === undefined || l === 'bullets')
}

/**
 * Columnas con formato «porcentaje» que guardan números mayores que 1,5 en sus datos (p. ej. 22 donde se quería 22 %, o sea 0,22). Solo
 * cuentan los números escritos: una fórmula o un texto no se juzga. Devuelve «hoja, columna n (valor)» por cada columna.
 */
export function percentMisfits(sheets: Array<{ name: string; columnFormats?: Array<string | null>; rows: unknown[][] }>): string[] {
  const out: string[] = []
  for (const sh of sheets)
    (sh.columnFormats ?? []).forEach((fmt, c) => {
      if (fmt !== 'percent') return
      const big = sh.rows
        .slice(1)
        .map((r) => r[c])
        .filter((v): v is number => typeof v === 'number' && v > 1.5)
      if (big.length) out.push(`${sh.name}, columna ${c + 1} (${big[0]})`)
    })
  return out
}

/**
 * Forma de las hojas (la primera fila es el encabezado): hojas con solo el encabezado (✘), encabezados de más de 25 caracteres y hojas de
 * más de 12 columnas (avisos). Devuelve los nombres o textos afectados.
 */
export function sheetShapeIssues(sheets: Array<{ name: string; rows: unknown[][] }>): {
  empty: string[]
  longHeader: string[]
  wide: string[]
} {
  const out = { empty: [] as string[], longHeader: [] as string[], wide: [] as string[] }
  for (const sh of sheets) {
    if (sh.rows.length <= 1) out.empty.push(sh.name)
    const header = sh.rows[0] ?? []
    for (const h of header) if (typeof h === 'string' && h.length > 25) out.longHeader.push(`«${h.slice(0, 25)}…» (${sh.name})`)
    if (header.length > 12) out.wide.push(`${sh.name} (${header.length} columnas)`)
  }
  return out
}

/** Familias de letra distintas en las declaraciones `font-family` de un CSS (sin comillas, en minúsculas). */
export function fontFamilies(css: string): string[] {
  const out = new Set<string>()
  for (const m of css.matchAll(/font-family\s*:\s*([^;}]+)/gi))
    for (const part of m[1].split(',')) {
      const f = part
        .trim()
        .replace(/^['"]+|['"]+$/g, '')
        .trim()
        .toLowerCase()
      if (f && !['inherit', 'initial', 'unset'].includes(f)) out.add(f)
    }
  return [...out]
}

/** Filas de tabla con más de `max` encabezados (`<th>`): en una página impresa se salen del ancho. */
export function wideHeaderRows(html: string, max = 8): number {
  return (html.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []).filter((tr) => (tr.match(/<th\b/gi) ?? []).length > max).length
}

/** `position: fixed` en el CSS: en un PDF se repite en cada página y tapa el contenido. */
export function hasFixedPosition(css: string): boolean {
  return /position\s*:\s*fixed/i.test(css)
}

/** Lámina cargada: más de 6 viñetas, o más de 60 palabras entre todas sus viñetas. */
export function denseBullets(bullets: string[] | undefined): boolean {
  if (!bullets?.length) return false
  return bullets.length > 6 || bullets.reduce((n, b) => n + countWords(b), 0) > 60
}

/** Cuántos tramos de dos o más `true` seguidos hay en `flags` (p. ej. párrafos vacíos seguidos). */
export function blankRuns(flags: boolean[]): number {
  let runs = 0
  let cur = 0
  for (const f of flags) {
    if (!f) cur = 0
    else if (++cur === 2) runs++
  }
  return runs
}

/** Palabras de un texto (separadas por espacios). */
export function countWords(text: string): number {
  const t = text.trim()
  return t ? t.split(/\s+/).length : 0
}

/**
 * Título o encabezado con forma de texto pegado: termina en punto, o va en mayúsculas sostenidas (4 letras o más, sin cifras; «KPI» y
 * «Q3 2026» no cuentan). Devuelve el motivo o `null`.
 */
export function headingStyleIssue(text: string): 'punto' | 'mayusculas' | null {
  const t = text.trim()
  if (/\.$/.test(t)) return 'punto'
  const letters = t.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 4 && !/\d/.test(t) && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return 'mayusculas'
  return null
}
