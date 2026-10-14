/**
 * Tolerancia de FORMA para los documentos de Chat (```xlsx/```pptx/```docx), ANTES de validar con el esquema estricto de
 * `chat-doc-spec.ts` (que sigue siendo el que manda, igual que el esquema IPC de `main/ipc/schemas.ts`).
 *
 * Un modelo (típicamente GPT) suele escribir el JSON "casi bien": una clave que no existe (`notes`, `subtitle`), una viñeta de 700
 * caracteres, un KPI numérico (`"value": 1250000`), una celda booleana… y el esquema estricto rechazaba TODO el bloque por un solo campo.
 * Aquí se corrige la forma:
 *  - claves desconocidas → se descartan (nunca se copian al resultado);
 *  - textos más largos que su límite → se recortan con «…»;
 *  - números/booleanos donde se espera texto → se pasan a texto;
 *  - listas demasiado largas → se acortan; filas de tabla de otro largo → se rellenan/recortan a las columnas;
 *  - enumeraciones desconocidas (tema, estilo, diseño, tipografía…) → se descartan y vale el predeterminado.
 *
 * NO relaja nada que proteja: un color que no sea hex se descarta, un bloque de tipo desconocido solo sobrevive si trae texto (como
 * párrafo) y uno `image`/`html`/`link` se descarta entero; no se inventa contenido. Quien lo usa igual valida el resultado.
 */
import {
  A1_CELL,
  A1_RANGE,
  DOCX_ALIGN,
  FREE_FONTS,
  HEX_RE,
  MAX_BULLETS_PER_SLIDE,
  MAX_BULLET_CHARS,
  MAX_CELL_CHARS,
  MAX_CHART_LABEL_CHARS,
  MAX_CHART_POINTS,
  MAX_COLS_PER_ROW,
  MAX_COLUMN_BULLETS,
  MAX_COLUMN_HEADING_CHARS,
  MAX_DOCX_BLOCKS,
  MAX_DOCX_COLS,
  MAX_DOCX_ITEMS,
  MAX_DOCX_META_CHARS,
  MAX_DOCX_ROWS,
  MAX_DOCX_TEXT_CHARS,
  MAX_EYEBROW_CHARS,
  MAX_FOOTER_CHARS,
  MAX_FREE_ELEMENTS,
  MAX_FREE_TEXT_CHARS,
  MAX_KPIS,
  MAX_KPI_DELTA_CHARS,
  MAX_KPI_LABEL_CHARS,
  MAX_KPI_VALUE_CHARS,
  MAX_NOTE_CHARS,
  MAX_ROWS_PER_SHEET,
  MAX_SHEETS,
  MAX_SLIDES,
  MAX_TABLE_CELL_CHARS,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  MAX_TITLE_CHARS,
  MAX_XLSX_CHARTS_PER_SHEET,
  MAX_XLSX_CHART_TITLE_CHARS,
  MIN_KPIS,
  MIN_TABLE_COLS,
  PPTX_CHART_TYPES,
  PPTX_LAYOUTS,
  PPTX_STYLES,
  PPTX_THEMES,
  PPTX_TRANSITIONS,
  XLSX_CHART_TYPES,
  XLSX_COLUMN_FORMATS,
  isFreeElement
} from './chat-doc-spec'
import { fixElement, normalizePptx } from './chat-doc-normalize'

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const asArray = (v: unknown): unknown[] | undefined => (Array.isArray(v) ? v : undefined)

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : s)

/** Texto a partir de un texto, número o booleano (cualquier otra cosa → `undefined`), recortado al límite. */
function toText(v: unknown, max: number): string | undefined {
  if (typeof v === 'string') return clip(v, max)
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? 'Sí' : 'No'
  return undefined
}

const finiteNum = (v: unknown): number | undefined => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}

const optHex = (v: unknown): string | undefined => (typeof v === 'string' && HEX_RE.test(v) ? v : undefined)

const pickKeys = (o: Obj, keys: readonly string[]): Obj => {
  const out: Obj = {}
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k]
  return out
}

// ───────────────────────── xlsx ─────────────────────────

function xlsxCell(c: unknown): unknown {
  if (c === null || c === undefined) return null
  if (typeof c === 'number') return Number.isFinite(c) ? c : null
  if (typeof c === 'string') return clip(c, MAX_CELL_CHARS)
  if (typeof c === 'boolean') return c ? 'Sí' : 'No'
  if (isObj(c) && typeof c.formula === 'string' && c.formula.length > 0 && c.formula.length <= MAX_CELL_CHARS) {
    const value =
      typeof c.value === 'number' && Number.isFinite(c.value) ? c.value : typeof c.value === 'string' ? clip(c.value, MAX_CELL_CHARS) : 0
    return { formula: c.formula, value }
  }
  return null
}

function xlsxChart(c: unknown): Obj | null {
  if (!isObj(c)) return null
  if (!(XLSX_CHART_TYPES as readonly unknown[]).includes(c.type)) return null
  if (typeof c.range !== 'string' || !A1_RANGE.test(c.range)) return null
  const out: Obj = { type: c.type, range: c.range }
  const title = toText(c.title, MAX_XLSX_CHART_TITLE_CHARS)
  if (title) out.title = title
  if (typeof c.at === 'string' && A1_CELL.test(c.at)) out.at = c.at
  for (const k of ['width', 'height'] as const) {
    const n = finiteNum(c[k])
    if (n !== undefined) out[k] = Math.min(1200, Math.max(120, n))
  }
  return out
}

function xlsxSheet(s: unknown, i: number): Obj | null {
  if (!isObj(s)) return null
  const rawRows = asArray(s.rows)
  if (!rawRows) return null
  const rows = rawRows
    .slice(0, MAX_ROWS_PER_SHEET)
    .filter(Array.isArray)
    .map((r) => (r as unknown[]).slice(0, MAX_COLS_PER_ROW).map(xlsxCell))
  const out: Obj = { name: toText(s.name, 31) ?? `Hoja ${i + 1}`, rows }
  const formats = asArray(s.columnFormats)
  if (formats) {
    out.columnFormats = formats.slice(0, MAX_COLS_PER_ROW).map((f) => ((XLSX_COLUMN_FORMATS as readonly unknown[]).includes(f) ? f : null))
  }
  const charts = asArray(s.charts)
  if (charts) {
    const ok = charts.map(xlsxChart).filter((c): c is Obj => c !== null)
    if (ok.length > 0) out.charts = ok.slice(0, MAX_XLSX_CHARTS_PER_SHEET)
  }
  return out
}

function sanitizeXlsx(doc: Obj): unknown {
  const sheets = asArray(doc.sheets)
  if (!sheets) return doc
  return {
    sheets: sheets
      .slice(0, MAX_SHEETS)
      .map(xlsxSheet)
      .filter((s) => s !== null)
  }
}

// ───────────────────────── pptx ─────────────────────────

const LAYOUT_ALIAS: Record<string, string> = {
  title: 'cover',
  'title-slide': 'cover',
  title_slide: 'cover',
  content: 'bullets',
  bullet: 'bullets',
  list: 'bullets',
  two_col: 'two-col',
  twocol: 'two-col',
  'two-column': 'two-col',
  'two-columns': 'two-col',
  comparison: 'two-col',
  'big-number': 'stat',
  number: 'stat',
  end: 'closing',
  thanks: 'closing',
  kpi: 'kpis',
  metrics: 'kpis'
}

function strings(v: unknown, max: number, maxChars: number): string[] | undefined {
  if (typeof v === 'string') return v.trim() ? [clip(v, maxChars)] : []
  const a = asArray(v)
  if (!a) return undefined
  return a
    .map((x) => toText(x, maxChars))
    .filter((x): x is string => x !== undefined)
    .slice(0, max)
}

function pptxChart(c: unknown): Obj | undefined {
  if (!isObj(c) || !(PPTX_CHART_TYPES as readonly unknown[]).includes(c.type)) return undefined
  const cats = asArray(c.categories)
  const vals = asArray(c.values)
  if (!cats || !vals) return undefined
  const n = Math.min(cats.length, vals.length, MAX_CHART_POINTS)
  const categories: string[] = []
  const values: number[] = []
  for (let i = 0; i < n; i++) {
    const label = toText(cats[i], MAX_CHART_LABEL_CHARS)
    const value = finiteNum(vals[i])
    if (!label || value === undefined) continue
    categories.push(label)
    values.push(value)
  }
  return categories.length > 0 ? { type: c.type, categories, values } : undefined
}

function pptxKpis(v: unknown): Obj[] | undefined {
  const a = asArray(v)
  if (!a) return undefined
  const out: Obj[] = []
  for (const k of a) {
    if (!isObj(k)) continue
    const label = toText(k.label, MAX_KPI_LABEL_CHARS)
    const value = toText(k.value, MAX_KPI_VALUE_CHARS)
    if (!label || !value) continue
    const delta = toText(k.delta, MAX_KPI_DELTA_CHARS)
    out.push({ label, value, ...(delta ? { delta } : {}) })
  }
  return out.slice(0, MAX_KPIS)
}

function pptxTable(t: unknown): Obj | undefined {
  if (!isObj(t)) return undefined
  const cols = asArray(t.columns)
  const rows = asArray(t.rows)
  if (!cols || !rows) return undefined
  const columns = cols.slice(0, MAX_TABLE_COLS).map((c) => toText(c, MAX_TABLE_CELL_CHARS) ?? '')
  if (columns.length < MIN_TABLE_COLS) return undefined
  const body = rows
    .slice(0, MAX_TABLE_ROWS)
    .filter(Array.isArray)
    .map((r) => columns.map((_, i) => toText((r as unknown[])[i], MAX_TABLE_CELL_CHARS) ?? ''))
  return body.length > 0 ? { columns, rows: body } : undefined
}

function pptxColumns(v: unknown): unknown[] | undefined {
  const a = asArray(v)
  if (!a || a.length !== 2) return undefined
  const cols = a.map((c) => {
    if (!isObj(c)) return null
    const heading = toText(c.heading, MAX_COLUMN_HEADING_CHARS)
    return { ...(heading ? { heading } : {}), bullets: strings(c.bullets, MAX_COLUMN_BULLETS, MAX_BULLET_CHARS) ?? [] }
  })
  return cols.every((c) => c !== null) ? cols : undefined
}

const COMMON_EL_KEYS = ['type', 'x', 'y', 'w', 'h', 'text', 'size', 'color', 'bold', 'align', 'font']
const TEXT_EL_KEYS = [...COMMON_EL_KEYS, 'italic', 'spacing']
const SHAPE_EL_KEYS = [...COMMON_EL_KEYS, 'shape', 'fill', 'fillTo', 'angle', 'opacity', 'line', 'lineWidth', 'rotate']

function pptxElement(e: unknown): Obj | null {
  const fixed = fixElement(e)
  if (!isObj(fixed) || (fixed.type !== 'text' && fixed.type !== 'shape')) return null
  const o = pickKeys(fixed, fixed.type === 'text' ? TEXT_EL_KEYS : SHAPE_EL_KEYS)
  for (const k of ['color', 'fill', 'fillTo', 'line']) if (o[k] !== undefined && !optHex(o[k])) delete o[k]
  if (o.font !== undefined && !(FREE_FONTS as readonly unknown[]).includes(o.font)) delete o.font
  if (o.align !== undefined && o.align !== 'left' && o.align !== 'center' && o.align !== 'right') delete o.align
  if (o.text !== undefined) o.text = toText(o.text, MAX_FREE_TEXT_CHARS)
  return isFreeElement(o) ? (o as Obj) : null
}

function pptxSlide(s: unknown): Obj | null {
  if (!isObj(s)) return null
  const o: Obj = {}
  const title = toText(s.title, MAX_TITLE_CHARS)
  if (title) o.title = title
  let bullets = strings(s.bullets, MAX_BULLETS_PER_SLIDE, MAX_BULLET_CHARS)
  // Un subtítulo suelto (muy típico de GPT en la portada) pasa a ser la primera viñeta si no hay viñetas.
  const subtitle = toText(s.subtitle, MAX_BULLET_CHARS)
  if (subtitle && (!bullets || bullets.length === 0)) bullets = [subtitle]
  if (bullets && bullets.length > 0) o.bullets = bullets
  if (typeof s.layout === 'string') {
    const key = s.layout.trim().toLowerCase()
    const layout = LAYOUT_ALIAS[key] ?? key
    if ((PPTX_LAYOUTS as readonly string[]).includes(layout)) o.layout = layout
  }
  const chart = pptxChart(s.chart)
  if (chart) o.chart = chart
  const eyebrow = toText(s.eyebrow, MAX_EYEBROW_CHARS)
  if (eyebrow) o.eyebrow = eyebrow
  const note = toText(s.note, MAX_NOTE_CHARS)
  if (note) o.note = note
  const columns = pptxColumns(s.columns)
  if (columns) o.columns = columns
  const kpis = pptxKpis(s.kpis)
  if (kpis && kpis.length >= MIN_KPIS) o.kpis = kpis
  const table = pptxTable(s.table)
  if (table) o.table = table
  const background = optHex(s.background)
  if (background) o.background = background
  const els = asArray(s.elements)
  if (els) {
    const ok = els
      .slice(0, MAX_FREE_ELEMENTS)
      .map(pptxElement)
      .filter((x) => x !== null)
    if (ok.length > 0) o.elements = ok
  }
  // Un diseño que necesita su dato y no lo tiene vuelve al predeterminado (en vez de invalidar toda la presentación).
  const needs: Record<string, string> = { chart: 'chart', kpis: 'kpis', table: 'table', free: 'elements' }
  if (typeof o.layout === 'string' && needs[o.layout] && o[needs[o.layout]] === undefined) delete o.layout
  return o
}

function sanitizePptx(doc: Obj): unknown {
  const slides = asArray(doc.slides)
  if (!slides) return doc
  const out: Obj = {}
  const pickEnum = (k: string, list: readonly string[]): void => {
    const v = doc[k]
    if (typeof v === 'string' && list.includes(v.toLowerCase())) out[k] = v.toLowerCase()
  }
  pickEnum('theme', PPTX_THEMES)
  pickEnum('style', PPTX_STYLES)
  pickEnum('transition', PPTX_TRANSITIONS)
  if (isObj(doc.palette)) {
    const p = doc.palette
    const bg = optHex(p.bg)
    const text = optHex(p.text)
    const accent = optHex(p.accent)
    if (bg && text && accent) {
      const palette: Obj = { bg, text, accent }
      for (const k of ['muted', 'accent2', 'panel', 'edge']) {
        const h = optHex(p[k])
        if (h) palette[k] = h
      }
      out.palette = palette
    }
  }
  if (isObj(doc.fonts)) {
    const fonts: Obj = {}
    for (const k of ['title', 'body']) if ((FREE_FONTS as readonly unknown[]).includes(doc.fonts[k])) fonts[k] = doc.fonts[k]
    if (Object.keys(fonts).length > 0) out.fonts = fonts
  }
  const footer = toText(doc.footer, MAX_FOOTER_CHARS)
  if (footer) out.footer = footer
  out.slides = slides
    .slice(0, MAX_SLIDES)
    .map(pptxSlide)
    .filter((s) => s !== null)
  return out
}

// ───────────────────────── docx ─────────────────────────

const docxText = (v: unknown): string | undefined => toText(v, MAX_DOCX_TEXT_CHARS)

function docxBlock(b: unknown): Obj | null {
  if (!isObj(b)) return null
  const type = typeof b.type === 'string' ? b.type.toLowerCase() : ''
  switch (type) {
    case 'heading': {
      const text = docxText(b.text)
      if (!text) return null
      const level = Math.round(finiteNum(b.level) ?? 1)
      return { type: 'heading', level: Math.min(3, Math.max(1, level)), text }
    }
    case 'paragraph': {
      const text = docxText(b.text)
      if (!text) return null
      return { type: 'paragraph', text, ...(typeof b.align === 'string' && DOCX_ALIGN.includes(b.align) ? { align: b.align } : {}) }
    }
    case 'bullets':
    case 'numbered': {
      const raw = typeof b.items === 'string' ? [b.items] : asArray(b.items)
      if (!raw) return null
      const items: (string | string[])[] = []
      for (const it of raw.slice(0, MAX_DOCX_ITEMS)) {
        if (Array.isArray(it)) {
          const sub = it.map(docxText).filter((x): x is string => x !== undefined)
          if (sub.length > 0) items.push(sub.slice(0, MAX_DOCX_ITEMS))
        } else {
          const text = docxText(it)
          if (text !== undefined) items.push(text)
        }
      }
      return items.length > 0 ? { type, items } : null
    }
    case 'table': {
      const cols = asArray(b.columns)
      const rows = asArray(b.rows)
      if (!cols || !rows || cols.length === 0) return null
      const columns = cols.slice(0, MAX_DOCX_COLS).map((c) => toText(c, 200) ?? '')
      const cell = (c: unknown): string | number | null => {
        if (typeof c === 'number') return Number.isFinite(c) ? c : null
        return c === null || c === undefined ? null : (toText(c, 500) ?? null)
      }
      const body = rows
        .slice(0, MAX_DOCX_ROWS)
        .filter(Array.isArray)
        .map((r) => columns.map((_, i) => cell((r as unknown[])[i])))
      if (body.length === 0) return null
      const out: Obj = { type: 'table', columns, rows: body }
      if (typeof b.total_row === 'boolean') out.total_row = b.total_row
      if (typeof b.zebra === 'boolean') out.zebra = b.zebra
      const align = asArray(b.align)
      if (align && align.every((a) => a === 'left' || a === 'right' || a === 'center')) out.align = align.slice(0, MAX_DOCX_COLS)
      const decimals = finiteNum(b.decimals)
      if (decimals !== undefined) out.decimals = Math.min(6, Math.max(0, Math.round(decimals)))
      const widths = asArray(b.widths_cm)?.map(finiteNum)
      if (widths && widths.every((w) => w !== undefined && w >= 1 && w <= 40)) out.widths_cm = widths.slice(0, MAX_DOCX_COLS)
      const caption = toText(b.caption, MAX_DOCX_META_CHARS)
      if (caption) out.caption = caption
      return out
    }
    case 'page_break':
    case 'pagebreak':
      return { type: 'page_break' }
    default: {
      // Un tipo que no existe pero trae texto (`quote`, `callout`, `text`…) se conserva como párrafo; `image`/`html`/`link` se descartan.
      if (type === 'image' || type === 'html' || type === 'link') return null
      const text = docxText(b.text)
      return text ? { type: 'paragraph', text } : null
    }
  }
}

function sanitizeDocx(doc: Obj): unknown {
  const blocks = asArray(doc.blocks)
  if (!blocks) return doc
  const out: Obj = {}
  for (const k of ['title', 'subtitle', 'author', 'date', 'header', 'footer']) {
    const v = toText(doc[k], MAX_DOCX_META_CHARS)
    if (v) out[k] = v
  }
  for (const k of ['page_numbers', 'toc']) if (typeof doc[k] === 'boolean') out[k] = doc[k]
  out.blocks = blocks
    .slice(0, MAX_DOCX_BLOCKS)
    .map(docxBlock)
    .filter((x) => x !== null)
  return out
}

/**
 * Limpia la FORMA de un documento de Chat y lo devuelve listo para el esquema estricto. Si no tiene la forma mínima del tipo
 * (p.ej. un pptx sin `slides`), lo devuelve tal cual para que el esquema lo rechace.
 */
export function sanitizeDoc(kind: 'xlsx' | 'pptx' | 'docx', doc: unknown): unknown {
  if (!isObj(doc)) return doc
  if (kind === 'xlsx') return sanitizeXlsx(doc)
  if (kind === 'docx') return sanitizeDocx(doc)
  const fixed = normalizePptx(doc)
  return isObj(fixed) ? sanitizePptx(fixed) : fixed
}

/**
 * ¿Qué documento de Chat es este JSON, si es inequívoco? Sirve para aceptar una valla ```json/```javascript/```text cuando el contenido
 * tiene la forma de la spec: `sheets:[{rows}]` → xlsx, `slides:[…]` → pptx, `blocks:[{type}]` → docx. Ambiguo u otra cosa → `null`.
 */
export function sniffDocKind(parsed: unknown): 'xlsx' | 'pptx' | 'docx' | null {
  if (!isObj(parsed)) return null
  const objs = (v: unknown): v is Obj[] => Array.isArray(v) && v.length > 0 && v.every(isObj)
  const found: ('xlsx' | 'pptx' | 'docx')[] = []
  if (objs(parsed.sheets) && parsed.sheets.every((s) => Array.isArray(s.rows))) found.push('xlsx')
  if (objs(parsed.slides)) found.push('pptx')
  if (objs(parsed.blocks) && parsed.blocks.every((b) => typeof b.type === 'string')) found.push('docx')
  return found.length === 1 ? found[0] : null
}
