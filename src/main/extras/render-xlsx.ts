/**
 * Datos estructurados del chat → `.xlsx` real (vía `exceljs`, sin Python): la Community Edition del
 * `xlsx` (SheetJS) que ya usa el visor para LEER no sabe escribir estilos de celda (confirmado en su
 * propio README — eso es exclusivo de la versión Pro de pago), así que para que el Excel se vea bien
 * (encabezado en negrita, ancho de columna) hace falta esta librería aparte, solo para escribir.
 */
import ExcelJS from 'exceljs'
import type { XlsxCell, XlsxColumnFormat, XlsxFormulaCell, XlsxSpec } from '@shared/chat-doc-spec'

export { isXlsxSpec, type XlsxSheetSpec, type XlsxSpec } from '@shared/chat-doc-spec'

const HEADER_FILL = 'FFE8ECF4'
const MAX_COL_WIDTH = 60
const MAX_SHEET_NAME = 31 // límite duro del formato .xlsx

/** Códigos de formato de número de Excel — nunca dependen de la configuración regional de quien lo abre. */
const NUM_FORMATS: Record<XlsxColumnFormat, string> = {
  currency: '"$"#,##0',
  integer: '#,##0',
  decimal: '#,##0.00',
  percent: '0.00%'
}

function isFormulaCell(cell: XlsxCell): cell is XlsxFormulaCell {
  return !!cell && typeof cell === 'object'
}

/** El valor que ExcelJS necesita para esta celda — una fórmula se pasa como `{formula, result}` (su propio shape). */
function cellValue(cell: XlsxCell): string | number | null | { formula: string; result: number | string } {
  return isFormulaCell(cell) ? { formula: cell.formula, result: cell.value } : cell
}

/** Texto a mostrar para calcular el ancho de columna (de una fórmula, su resultado — no "[object Object]"). */
function cellDisplayText(cell: XlsxCell): string {
  return String((isFormulaCell(cell) ? cell.value : cell) ?? '')
}

/**
 * `data.sheets[].rows[0]` es el encabezado (negrita + fondo suave); el ancho de columna se ajusta al
 * contenido. `columnFormats` se aplica a la columna entera vía `col.numFmt` — un formato de número en
 * una celda de texto (el encabezado) no tiene ningún efecto visible, así que no hace falta saltarlo.
 */
export async function renderXlsx(data: XlsxSpec): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  const usedNames = new Set<string>()
  for (const sheet of data.sheets) {
    let name = (sheet.name || 'Hoja').slice(0, MAX_SHEET_NAME) || 'Hoja'
    while (usedNames.has(name)) name = `${name.slice(0, MAX_SHEET_NAME - 2)}·2`.slice(0, MAX_SHEET_NAME)
    usedNames.add(name)
    const ws = wb.addWorksheet(name)
    for (const row of sheet.rows) ws.addRow(row.map(cellValue))
    if (sheet.rows.length > 0) {
      const header = ws.getRow(1)
      header.font = { bold: true }
      header.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
      })
    }
    sheet.columnFormats?.forEach((format, colIndex) => {
      if (format) ws.getColumn(colIndex + 1).numFmt = NUM_FORMATS[format]
    })
    ws.columns.forEach((col, colIndex) => {
      let max = 10
      for (const row of sheet.rows) {
        const len = cellDisplayText(row[colIndex]).length
        if (len > max) max = len
      }
      col.width = Math.min(max + 2, MAX_COL_WIDTH)
    })
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
