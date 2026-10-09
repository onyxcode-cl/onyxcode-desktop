/**
 * Forma de los datos que el agente de Chat escribe en un bloque ```xlsx/```pptx (JSON) para que
 * main genere el archivo real — mismo espíritu que el bloque ```html, pero para contenido
 * estructurado en vez de markup. Compartido entre renderer (detecta/pasa el bloque tal cual) y main
 * (lo valida y genera el archivo, `src/main/extras/render-{xlsx,pptx}.ts`).
 *
 * Los límites de abajo no son por el tamaño del archivo en sí (eso ya lo limita `MAX_BYTES` del
 * visor, `src/main/viewer/doc-kind.ts`) sino para que un JSON patológico (una hoja de 500 000 filas,
 * una celda de un millón de caracteres) no cuelgue `exceljs`/`pptxgenjs` generando algo que nadie va
 * a poder ver de todos modos.
 */

export const MAX_SHEETS = 10
export const MAX_ROWS_PER_SHEET = 5_000
export const MAX_COLS_PER_ROW = 60
export const MAX_CELL_CHARS = 2_000

export const MAX_SLIDES = 40
export const MAX_BULLETS_PER_SLIDE = 20
export const MAX_BULLET_CHARS = 500
export const MAX_TITLE_CHARS = 200
export const MAX_CHART_POINTS = 12
export const MAX_CHART_LABEL_CHARS = 40
export const MAX_EYEBROW_CHARS = 40
export const MAX_NOTE_CHARS = 140
export const MAX_FOOTER_CHARS = 60
export const MAX_COLUMN_HEADING_CHARS = 60
export const MAX_COLUMN_BULLETS = 6
export const MAX_KPIS = 4
export const MIN_KPIS = 2
export const MAX_KPI_LABEL_CHARS = 40
export const MAX_KPI_VALUE_CHARS = 16
export const MAX_KPI_DELTA_CHARS = 40

/**
 * Formato de número por columna (índice 0-based, alineado con las celdas de `rows`) — nunca estilo
 * visual (color/negrita, eso ya lo pone el renderer solo en el encabezado): cómo mostrar un número
 * que YA es un número de JSON de verdad, nunca una forma de convertir texto en número.
 */
export type XlsxColumnFormat = 'currency' | 'integer' | 'decimal' | 'percent'

/**
 * Una fórmula de Excel de verdad (p.ej. `{"formula":"SUM(B2:B5)","value":1100000}`) — se escribe
 * directo al XML del .xlsx (`<f>SUM(B2:B5)</f>`), así que NO depende de la configuración regional de
 * separador de argumentos (`;` vs `,`) de quien lo abra — esa dependencia solo existe cuando una
 * PERSONA tipea la fórmula a mano en la barra de fórmulas de Excel, nunca al escribirla directo al
 * archivo. `value` es el resultado YA calculado (el agente lo sabe: armó los datos de la fórmula) —
 * sirve para que la vista previa interna muestre algo de inmediato; Excel de verdad recalcula solo
 * al abrir o editar, así que `value` nunca queda "pisando" lo que Excel calcule después.
 */
export interface XlsxFormulaCell {
  formula: string
  value: number | string
}

export type XlsxCell = string | number | null | XlsxFormulaCell

export interface XlsxSheetSpec {
  name: string
  rows: XlsxCell[][]
  /** `columnFormats[i]` es el formato de la columna `i`; `null`/ausente = sin formato especial. */
  columnFormats?: (XlsxColumnFormat | null)[]
}

export interface XlsxSpec {
  sheets: XlsxSheetSpec[]
}

/** Paleta de color de la presentación entera — sin esto, "blue" (el mismo celeste de siempre). */
export type PptxTheme = 'blue' | 'green' | 'dark' | 'warm' | 'mono'
const PPTX_THEMES: readonly PptxTheme[] = ['blue', 'green', 'dark', 'warm', 'mono']

/**
 * Estilo VISUAL de la presentación entera (forma, decoración, tipografía de forma) — un eje distinto
 * de `theme` (que es solo color): sin esto, "classic" (el look de siempre). "editorial" (línea fina
 * en vez de círculo decorativo, tarjetas de esquina recta sin relleno — más revista/sobrio),
 * "geometric" (barra diagonal de acento, tarjetas bien redondeadas tipo "pill" — más gráfico/audaz) o
 * "minimal" (sin ninguna decoración, tarjetas de esquina recta solo con borde fino — tipo informe
 * ejecutivo ultra limpio).
 */
export type PptxStyle = 'classic' | 'editorial' | 'geometric' | 'minimal'
const PPTX_STYLES: readonly PptxStyle[] = ['classic', 'editorial', 'geometric', 'minimal']

/**
 * Tipo de diapositiva. Sin indicarlo, se infiere: la primera es "cover"; una diapositiva CON título
 * y SIN viñetas (que no sea la primera) es "section" (separador a toda página, para dividir temas);
 * cualquier otra es "bullets". El resto solo sale si se pide a propósito — no se infiere, para no
 * adivinar mal: "closing" (cierre/agradecimiento), "stat" (una cifra grande — `title` es la cifra,
 * p.ej. "80%", y el primer `bullet` la explica), "steps" (las `bullets` se ven como pasos numerados,
 * para un proceso/secuencia), "two-col" (las `bullets` se reparten en dos columnas, para comparar dos
 * cosas lado a lado), "cards" (cada `bullet` sale como una tarjeta, para una lista de ítems/ventajas
 * que no son un proceso en orden), "chart" (un gráfico real — ver `chart` en `PptxSlideSpec`) y
 * "kpis" (2 a 4 métricas en fila, cada una con su etiqueta/número grande/variación — ver `kpis` —
 * para un resumen tipo tablero al principio de la presentación, DISTINTO de "stat": "stat" es UNA
 * cifra como foco de toda la diapositiva, "kpis" son VARIAS métricas juntas, más chicas).
 */
export type PptxLayout = 'cover' | 'section' | 'bullets' | 'closing' | 'stat' | 'steps' | 'two-col' | 'cards' | 'chart' | 'kpis'
const PPTX_LAYOUTS: readonly PptxLayout[] = ['cover', 'section', 'bullets', 'closing', 'stat', 'steps', 'two-col', 'cards', 'chart', 'kpis']

/** Un gráfico nativo de PowerPoint (de verdad editable ahí, no una imagen) — una sola serie de datos. */
export type PptxChartType = 'bar' | 'line' | 'pie'
const PPTX_CHART_TYPES: readonly PptxChartType[] = ['bar', 'line', 'pie']

export interface PptxChartSpec {
  type: PptxChartType
  /** Una etiqueta por dato (eje X en barra/línea, porción en torta). */
  categories: string[]
  /** Un número por cada `categories[i]`, mismo largo que `categories`. */
  values: number[]
}

/** Una columna de `layout: "two-col"` — si no se da `columns`, se reparten `bullets` mitad y mitad (como antes). */
export interface PptxColumnSpec {
  heading?: string
  bullets: string[]
}

/** Una métrica de `layout: "kpis"` — p.ej. `{"label":"Ventas totales","value":"$433 M","delta":"+18% vs. trimestre anterior"}`. */
export interface PptxKpiSpec {
  label: string
  value: string
  delta?: string
}

export interface PptxSlideSpec {
  title?: string
  bullets?: string[]
  layout?: PptxLayout
  /** Solo se usa (y hace falta) con `layout: "chart"`. */
  chart?: PptxChartSpec
  /**
   * Etiqueta chica en mayúsculas arriba del título (p.ej. "VENTAS", "CIFRA DESTACADA") — PURAMENTE
   * visual, nunca se inventa si no viene: en diapositivas de sección, sin esto se numera sola
   * ("02") en vez de inventar texto.
   */
  eyebrow?: string
  /** Nota chica al pie (p.ej. "Cifras en miles de USD") — solo si hay algo real que decir; nunca se inventa "Datos ilustrativos" ni similar. */
  note?: string
  /** Dos columnas con su propio encabezado — solo para `layout: "two-col"`; si no viene, se usan `bullets` repartidas mitad y mitad. */
  columns?: [PptxColumnSpec, PptxColumnSpec]
  /** De 2 a 4 métricas en fila — solo para `layout: "kpis"`. */
  kpis?: PptxKpiSpec[]
}

export interface PptxSpec {
  theme?: PptxTheme
  /** Estilo visual de TODA la presentación (ver `PptxStyle`) — sin esto, "classic". */
  style?: PptxStyle
  slides: PptxSlideSpec[]
  /** Nota al pie de TODA la presentación (p.ej. "Empresa Ejemplo · Q3 2026") — una diapositiva con su propio `note` la pisa ahí. */
  footer?: string
}

const XLSX_COLUMN_FORMATS: readonly XlsxColumnFormat[] = ['currency', 'integer', 'decimal', 'percent']

function isFormulaCell(v: unknown): v is XlsxFormulaCell {
  if (!v || typeof v !== 'object') return false
  const c = v as XlsxFormulaCell
  if (typeof c.formula !== 'string' || c.formula.length === 0 || c.formula.length > MAX_CELL_CHARS) return false
  return typeof c.value === 'number' || (typeof c.value === 'string' && c.value.length <= MAX_CELL_CHARS)
}

function isCell(v: unknown): v is XlsxCell {
  if (v === null || typeof v === 'number') return true
  if (typeof v === 'string') return v.length <= MAX_CELL_CHARS
  return isFormulaCell(v)
}

function isRow(v: unknown): v is XlsxCell[] {
  return Array.isArray(v) && v.length <= MAX_COLS_PER_ROW && v.every(isCell)
}

function isColumnFormats(v: unknown): v is (XlsxColumnFormat | null)[] {
  return (
    Array.isArray(v) && v.length <= MAX_COLS_PER_ROW && v.every((f) => f === null || XLSX_COLUMN_FORMATS.includes(f as XlsxColumnFormat))
  )
}

function isSheet(v: unknown): v is XlsxSheetSpec {
  if (
    !v ||
    typeof v !== 'object' ||
    typeof (v as XlsxSheetSpec).name !== 'string' ||
    !Array.isArray((v as XlsxSheetSpec).rows) ||
    (v as XlsxSheetSpec).rows.length > MAX_ROWS_PER_SHEET ||
    !(v as XlsxSheetSpec).rows.every(isRow)
  )
    return false
  const formats = (v as XlsxSheetSpec).columnFormats
  return formats === undefined || isColumnFormats(formats)
}

export function isXlsxSpec(v: unknown): v is XlsxSpec {
  return (
    !!v &&
    typeof v === 'object' &&
    Array.isArray((v as XlsxSpec).sheets) &&
    (v as XlsxSpec).sheets.length > 0 &&
    (v as XlsxSpec).sheets.length <= MAX_SHEETS &&
    (v as XlsxSpec).sheets.every(isSheet)
  )
}

function isChartSpec(v: unknown): v is PptxChartSpec {
  if (!v || typeof v !== 'object') return false
  const c = v as PptxChartSpec
  if (!PPTX_CHART_TYPES.includes(c.type)) return false
  if (!Array.isArray(c.categories) || !Array.isArray(c.values)) return false
  if (c.categories.length === 0 || c.categories.length > MAX_CHART_POINTS) return false
  if (c.categories.length !== c.values.length) return false
  if (!c.categories.every((l) => typeof l === 'string' && l.length > 0 && l.length <= MAX_CHART_LABEL_CHARS)) return false
  return c.values.every((n) => typeof n === 'number' && Number.isFinite(n))
}

function isBulletList(v: unknown, max: number): v is string[] {
  return Array.isArray(v) && v.length <= max && v.every((b) => typeof b === 'string' && b.length <= MAX_BULLET_CHARS)
}

function isColumnSpec(v: unknown): v is PptxColumnSpec {
  if (!v || typeof v !== 'object') return false
  const c = v as PptxColumnSpec
  if (c.heading !== undefined && (typeof c.heading !== 'string' || c.heading.length > MAX_COLUMN_HEADING_CHARS)) return false
  return isBulletList(c.bullets, MAX_COLUMN_BULLETS)
}

function isKpiSpec(v: unknown): v is PptxKpiSpec {
  if (!v || typeof v !== 'object') return false
  const k = v as PptxKpiSpec
  if (typeof k.label !== 'string' || k.label.length === 0 || k.label.length > MAX_KPI_LABEL_CHARS) return false
  if (typeof k.value !== 'string' || k.value.length === 0 || k.value.length > MAX_KPI_VALUE_CHARS) return false
  if (k.delta !== undefined && (typeof k.delta !== 'string' || k.delta.length > MAX_KPI_DELTA_CHARS)) return false
  return true
}

function isSlide(v: unknown): v is PptxSlideSpec {
  if (!v || typeof v !== 'object') return false
  const s = v as PptxSlideSpec
  if (s.title !== undefined && (typeof s.title !== 'string' || s.title.length > MAX_TITLE_CHARS)) return false
  if (s.bullets !== undefined && !isBulletList(s.bullets, MAX_BULLETS_PER_SLIDE)) return false
  if (s.layout !== undefined && !PPTX_LAYOUTS.includes(s.layout)) return false
  if (s.chart !== undefined && !isChartSpec(s.chart)) return false
  if (s.eyebrow !== undefined && (typeof s.eyebrow !== 'string' || s.eyebrow.length > MAX_EYEBROW_CHARS)) return false
  if (s.note !== undefined && (typeof s.note !== 'string' || s.note.length > MAX_NOTE_CHARS)) return false
  if (s.columns !== undefined) {
    if (!Array.isArray(s.columns) || s.columns.length !== 2) return false
    if (!s.columns.every(isColumnSpec)) return false
  }
  if (s.kpis !== undefined) {
    if (!Array.isArray(s.kpis) || s.kpis.length < MIN_KPIS || s.kpis.length > MAX_KPIS) return false
    if (!s.kpis.every(isKpiSpec)) return false
  }
  return true
}

export function isPptxSpec(v: unknown): v is PptxSpec {
  if (!v || typeof v !== 'object') return false
  const spec = v as PptxSpec
  if (spec.theme !== undefined && !PPTX_THEMES.includes(spec.theme)) return false
  if (spec.style !== undefined && !PPTX_STYLES.includes(spec.style)) return false
  if (spec.footer !== undefined && (typeof spec.footer !== 'string' || spec.footer.length > MAX_FOOTER_CHARS)) return false
  return Array.isArray(spec.slides) && spec.slides.length > 0 && spec.slides.length <= MAX_SLIDES && spec.slides.every(isSlide)
}
