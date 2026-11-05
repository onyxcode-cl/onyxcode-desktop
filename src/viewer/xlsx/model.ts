/**
 * Convierte un `WorkBook` de SheetJS (ya parseado en el Worker) a un modelo plano, fácil de pintar
 * en una grilla virtualizada (Fase 3 del plan del visor). Módulo PURO: no toca SheetJS ni el DOM.
 *
 * El tamaño del modelo SIEMPRE sale de los datos que SheetJS realmente leyó (`!data.length`), nunca
 * del rango declarado en `!ref` — un xlsx hostil puede declarar `!ref: "A1:ZZZ1048576"` sin tener casi
 * ninguna celda real, y reservar memoria para el rango declarado sería una bomba de memoria barata.
 */
import { boldCellsOf } from './bold'
import type { CellObject, ColInfo, Range, RowInfo, WorkBook, WorkSheet } from 'xlsx'

export const DEFAULT_COL_WIDTH_PX = 80
export const DEFAULT_ROW_HEIGHT_PX = 20

export interface GridCell {
  /** Texto a mostrar: el formateado de SheetJS (`w`), o el valor crudo si no hay, o vacío. */
  text: string
  /** Fórmula de la celda (sin el `=`), para mostrar en un tooltip. */
  formula?: string
  /** Color de relleno sólido, en css (`#rrggbb`), si la celda tiene uno y es resoluble sin el tema. */
  fill?: string
  /** Color del texto cuando la celda tiene relleno: claro sobre fondos oscuros y oscuro sobre fondos claros (el color de la fuente del libro no llega). */
  color?: string
  /** true si la fuente de la celda es negrita. */
  bold?: boolean
  /** true en toda celda cubierta por una combinada que no es la esquina superior izquierda. */
  covered?: boolean
}

export interface MergeRect {
  r1: number
  c1: number
  r2: number
  c2: number
}

export interface GridSheet {
  name: string
  /** Filas realmente disponibles en el modelo (recortadas a lo que SheetJS leyó, nunca al `!ref` declarado). */
  rows: number
  cols: number
  cells: GridCell[][]
  merges: MergeRect[]
  colWidthsPx: number[]
  rowHeightsPx: number[]
  /** true si `!ref` declaraba más filas de las que realmente se leyeron (p. ej. por el tope `sheetRows`). */
  truncated: boolean
}

export interface GridWorkbook {
  sheets: GridSheet[]
}

function fillOf(style: unknown): string | undefined {
  const s = style as { patternType?: string; fgColor?: { rgb?: string } } | undefined
  if (!s || s.patternType !== 'solid' || !s.fgColor?.rgb) return undefined
  return `#${s.fgColor.rgb.slice(-6)}`
}

/** Texto blanco o casi negro según la luminosidad del relleno (`#rrggbb`), para que nunca quede oscuro sobre oscuro. */
export function contrastColor(fill: string): string {
  const n = parseInt(fill.slice(1), 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum < 0.55 ? '#ffffff' : '#1a1a1a'
}

function cellOf(raw: CellObject | undefined, bold = false): GridCell {
  if (!raw) return { text: '' }
  const text = raw.w ?? (raw.v === undefined || raw.v === null ? '' : String(raw.v))
  const fill = fillOf(raw.s)
  return {
    text,
    ...(raw.f ? { formula: raw.f } : {}),
    ...(fill ? { fill, color: contrastColor(fill) } : {}),
    ...(bold ? { bold: true } : {})
  }
}

/** Filas/columnas declaradas por `!ref` (solo para saber si el parseo se recortó, nunca para reservar memoria). */
function declaredSize(ref: string | undefined): { rows: number; cols: number } {
  if (!ref) return { rows: 0, cols: 0 }
  const m = /^[A-Z]+\d+:([A-Z]+)(\d+)$/.exec(ref)
  if (!m) return { rows: 0, cols: 0 }
  const [, colLetters, rowStr] = m
  let col = 0
  for (const ch of colLetters) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { rows: Number(rowStr), cols: col }
}

/** Tope del ancho que se agranda una columna para que su contenido se lea completo. */
export const MAX_AUTO_COL_WIDTH_PX = 320
const CHAR_WIDTH_PX = 7.5
const CELL_PADDING_PX = 16
const AUTOFIT_ROWS = 300

/**
 * Ancho de cada columna: el del archivo si lo trae, pero nunca menos de lo que necesita el texto de sus primeras filas (así no se corta
 * «Ken T» ni un encabezado en negrita). Las combinadas no cuentan: su texto se reparte en varias columnas.
 */
function widthsOf(cols: ColInfo[] | undefined, count: number, cells: GridCell[][], merges: MergeRect[]): number[] {
  const inMerge = (r: number, c: number): boolean => merges.some((m) => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2 && m.c2 > m.c1)
  return Array.from({ length: count }, (_, c) => {
    const base = cols?.[c]?.wpx ?? DEFAULT_COL_WIDTH_PX
    let longest = 0
    for (let r = 0; r < Math.min(cells.length, AUTOFIT_ROWS); r++) {
      const cell = cells[r][c]
      if (!cell || cell.covered || !cell.text || inMerge(r, c)) continue
      const w = cell.text.length * CHAR_WIDTH_PX * (cell.bold ? 1.08 : 1) + CELL_PADDING_PX
      if (w > longest) longest = w
    }
    return Math.max(base, Math.min(Math.ceil(longest), MAX_AUTO_COL_WIDTH_PX))
  })
}

function heightsOf(rows: RowInfo[] | undefined, count: number): number[] {
  return Array.from({ length: count }, (_, i) => rows?.[i]?.hpx ?? DEFAULT_ROW_HEIGHT_PX)
}

function mergesOf(merges: Range[] | undefined): MergeRect[] {
  return (merges ?? []).map((m) => ({ r1: m.s.r, c1: m.s.c, r2: m.e.r, c2: m.e.c }))
}

function markCovered(cells: GridCell[][], merges: MergeRect[]): void {
  for (const m of merges) {
    for (let r = m.r1; r <= m.r2; r++) {
      for (let c = m.c1; c <= m.c2; c++) {
        if (r === m.r1 && c === m.c1) continue
        if (cells[r]?.[c]) cells[r][c] = { ...cells[r][c], covered: true }
      }
    }
  }
}

/** `sheet['!data']` (modo denso) o, si no está, un arreglo vacío — nunca se arma desde `!ref`. */
function denseRows(sheet: WorkSheet): CellObject[][] {
  const data = (sheet as { '!data'?: CellObject[][] })['!data']
  return data ?? []
}

export function sheetToGrid(name: string, sheet: WorkSheet, bold?: Set<string>): GridSheet {
  const rowsRaw = denseRows(sheet)
  const rows = rowsRaw.length
  const cols = rows === 0 ? 0 : Math.max(...rowsRaw.map((r) => r.length), declaredSize(sheet['!ref']).cols)
  const cells: GridCell[][] = rowsRaw.map((row, r) => Array.from({ length: cols }, (_, c) => cellOf(row[c], bold?.has(`${r},${c}`))))
  const merges = mergesOf(sheet['!merges'])
  markCovered(cells, merges)
  const declared = declaredSize(sheet['!ref'])
  return {
    name,
    rows,
    cols,
    cells,
    merges,
    colWidthsPx: widthsOf(sheet['!cols'], cols, cells, merges),
    rowHeightsPx: heightsOf(sheet['!rows'], rows),
    truncated: declared.rows > rows
  }
}

export function workbookToGrid(wb: WorkBook): GridWorkbook {
  const bold = boldCellsOf(wb)
  return { sheets: wb.SheetNames.map((name) => sheetToGrid(name, wb.Sheets[name], bold.get(name))) }
}

/** Letra(s) de columna de Excel para un índice 0-based (0 → "A", 25 → "Z", 26 → "AA"...). */
export function colLetter(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}
