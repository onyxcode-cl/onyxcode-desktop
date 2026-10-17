import { read, utils, type CellObject, type WorkSheet } from 'xlsx'
import { OFFICE_MAX_CELL_CHARS, OFFICE_MAX_COLS, OFFICE_MAX_ROWS, OFFICE_MAX_SHEETS } from '@shared/attach-office'
import { t } from '@shared/i18n'
import { cleanLine, mdCell, mdTableLines, Out } from './markdown'
import { ExtractError } from './zip'
import type { Extracted } from './types'

const MAX_FORMULA_CHARS = 200

function cellText(cell: CellObject | undefined): string {
  if (!cell) return ''
  let v = ''
  if (cell.w !== undefined && cell.w !== '') v = String(cell.w)
  else if (cell.v !== undefined && cell.v !== null) v = cell.v instanceof Date ? cell.v.toISOString() : String(cell.v)
  v = cleanLine(v)
  if (typeof cell.f === 'string' && cell.f) {
    const f = cleanLine(cell.f).slice(0, MAX_FORMULA_CHARS)
    // Valor y fórmula como TEXTO: nada se calcula ni se ejecuta aquí.
    v = v ? `${v} (=${f})` : `=${f}`
  }
  return mdCell(v, OFFICE_MAX_CELL_CHARS)
}

/** Excel (.xlsx/.xlsm/.xlsb/.xls) y OpenDocument (.ods): cada hoja como tabla Markdown con valores y fórmulas como texto. */
export function extractSheets(buf: Uint8Array): Extracted {
  let wb
  try {
    wb = read(buf, {
      type: 'buffer',
      cellFormula: true,
      cellText: true,
      cellDates: false,
      cellHTML: false,
      cellStyles: false,
      bookVBA: false, // los macros ni se cargan
      WTF: false
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/password|encrypt/i.test(msg)) throw new ExtractError('encrypted')
    throw new ExtractError('corrupt')
  }
  const names = wb.SheetNames ?? []
  if (names.length === 0) throw new ExtractError('corrupt')

  const out = new Out()
  const notes: string[] = []
  const shownSheets = names.slice(0, OFFICE_MAX_SHEETS)
  let writtenSheets = 0
  for (const name of shownSheets) {
    const ws: WorkSheet | undefined = wb.Sheets[name]
    const title = cleanLine(name) || '?'
    if (writtenSheets > 0 && !out.add('')) break
    if (!out.add(`## ${t('attach.office.sheet')} «${title}»`)) break
    writtenSheets++
    const ref = ws?.['!ref']
    if (!ws || !ref) {
      out.add(t('attach.office.sheetEmpty'))
      continue
    }
    const range = utils.decode_range(ref)
    const totalRows = range.e.r - range.s.r + 1
    const totalCols = range.e.c - range.s.c + 1
    const rows = Math.min(totalRows, OFFICE_MAX_ROWS)
    const cols = Math.min(totalCols, OFFICE_MAX_COLS)
    out.add(t('attach.office.sheetRange', { range: ref, rows: totalRows, cols: totalCols }))
    out.add('')
    const grid: string[][] = []
    for (let r = 0; r < rows; r++) {
      const row: string[] = []
      for (let c = 0; c < cols; c++) {
        row.push(cellText(ws[utils.encode_cell({ r: range.s.r + r, c: range.s.c + c })]))
      }
      grid.push(row)
    }
    const lines = mdTableLines(grid)
    let added = 0
    for (const l of lines) {
      if (!out.add(l)) break
      added++
    }
    // Encabezado + separador son 2 líneas para 1 fila; cada línea siguiente es una fila.
    const shownRows = out.full ? Math.max(0, added - 1) : rows
    if (shownRows < totalRows) notes.push(t('attach.office.note.rows', { sheet: title, shown: shownRows, total: totalRows }))
    if (cols < totalCols) notes.push(t('attach.office.note.cols', { sheet: title, shown: cols, total: totalCols }))
    if (out.full) break
  }
  if (names.length > writtenSheets) notes.push(t('attach.office.note.sheets', { shown: writtenSheets, total: names.length }))
  return { body: out.toString(), units: names.length, notes, truncated: out.truncated }
}
