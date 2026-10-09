import { describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { isXlsxSpec, renderXlsx, type XlsxSpec } from './render-xlsx'

describe('isXlsxSpec', () => {
  it('acepta una especificación válida (una o más hojas, filas de texto/número/null)', () => {
    expect(
      isXlsxSpec({
        sheets: [
          {
            name: 'Gastos',
            rows: [
              ['Fecha', 'Monto'],
              ['2026-10-01', 85000]
            ]
          }
        ]
      })
    ).toBe(true)
  })

  it('rechaza sin hojas', () => {
    expect(isXlsxSpec({ sheets: [] })).toBe(false)
  })

  it('rechaza una celda que no sea texto/número/null/fórmula (p. ej. un booleano)', () => {
    expect(isXlsxSpec({ sheets: [{ name: 'X', rows: [[true]] }] })).toBe(false)
  })

  it('acepta una celda de fórmula {formula,value}', () => {
    expect(isXlsxSpec({ sheets: [{ name: 'X', rows: [[{ formula: 'SUM(A1:A2)', value: 100 }]] }] })).toBe(true)
  })

  it('rechaza una fórmula sin "value" o con "formula" vacío', () => {
    expect(isXlsxSpec({ sheets: [{ name: 'X', rows: [[{ formula: 'SUM(A1:A2)' }]] }] })).toBe(false)
    expect(isXlsxSpec({ sheets: [{ name: 'X', rows: [[{ formula: '', value: 1 }]] }] })).toBe(false)
  })

  it('acepta columnFormats válido, rechaza uno con un formato desconocido', () => {
    expect(isXlsxSpec({ sheets: [{ name: 'X', rows: [[1]], columnFormats: ['currency'] }] })).toBe(true)
    expect(isXlsxSpec({ sheets: [{ name: 'X', rows: [[1]], columnFormats: ['moneda'] }] })).toBe(false)
  })

  it('rechaza cualquier cosa que no tenga la forma esperada', () => {
    expect(isXlsxSpec(null)).toBe(false)
    expect(isXlsxSpec('texto')).toBe(false)
    expect(isXlsxSpec({})).toBe(false)
  })
})

describe('renderXlsx: genera un .xlsx real, releíble', () => {
  it('una hoja con encabezado en negrita: SheetJS lo relee con los mismos datos', async () => {
    const spec: XlsxSpec = {
      sheets: [
        {
          name: 'Gastos',
          rows: [
            ['Fecha', 'Monto'],
            ['2026-10-01', 85000],
            ['2026-10-02', 62450]
          ]
        }
      ]
    }
    const buf = await renderXlsx(spec)
    expect(buf.subarray(0, 2).toString()).toBe('PK') // firma de archivo zip (.xlsx es un zip)
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames).toEqual(['Gastos'])
    const rows = XLSX.utils.sheet_to_json(wb.Sheets.Gastos, { header: 1 })
    expect(rows).toEqual([
      ['Fecha', 'Monto'],
      ['2026-10-01', 85000],
      ['2026-10-02', 62450]
    ])
  })

  it('varias hojas: cada una con su propio nombre y filas', async () => {
    const spec: XlsxSpec = {
      sheets: [
        { name: 'Resumen', rows: [['Total', 100]] },
        {
          name: 'Detalle',
          rows: [
            ['Ítem', 'Valor'],
            ['Uno', 50]
          ]
        }
      ]
    }
    const buf = await renderXlsx(spec)
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames).toEqual(['Resumen', 'Detalle'])
  })

  it('nombres de hoja repetidos no chocan (Excel no permite dos hojas con el mismo nombre)', async () => {
    const spec: XlsxSpec = {
      sheets: [
        { name: 'Hoja', rows: [['a']] },
        { name: 'Hoja', rows: [['b']] }
      ]
    }
    const buf = await renderXlsx(spec)
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(new Set(wb.SheetNames).size).toBe(2)
  })

  it('nombre de hoja de más de 31 caracteres se recorta (límite del formato .xlsx)', async () => {
    const spec: XlsxSpec = { sheets: [{ name: 'Un nombre de hoja increíblemente largo que no entra', rows: [['x']] }] }
    const buf = await renderXlsx(spec)
    const wb = XLSX.read(buf, { type: 'buffer' })
    expect(wb.SheetNames[0].length).toBeLessThanOrEqual(31)
  })

  it('una celda de fórmula se escribe como fórmula de Excel de verdad, no como el resultado fijo', async () => {
    const spec: XlsxSpec = {
      sheets: [
        {
          name: 'T',
          rows: [
            ['a', 10],
            ['b', 20],
            ['Total', { formula: 'SUM(B1:B2)', value: 30 }]
          ]
        }
      ]
    }
    const buf = await renderXlsx(spec)
    const wb = XLSX.read(buf, { type: 'buffer', cellFormula: true })
    const cell = wb.Sheets.T['B3']
    expect(cell.f).toBe('SUM(B1:B2)')
    expect(cell.v).toBe(30) // el "cached result" que mandó el agente: la vista previa muestra esto hasta que Excel recalcule
  })

  it('columnFormats aplica un formato de número real a toda la columna (no solo al encabezado)', async () => {
    const spec: XlsxSpec = {
      sheets: [{ name: 'T', rows: [['Monto'], [85000], [62450]], columnFormats: ['currency'] }]
    }
    const buf = await renderXlsx(spec)
    const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true })
    expect(wb.Sheets.T['A2'].z).toBe('"$"#,##0')
    expect(wb.Sheets.T['A2'].w).toBe('$85,000')
  })

  it('columnFormats con null en una posición no le pone formato a esa columna', async () => {
    const spec: XlsxSpec = {
      sheets: [
        {
          name: 'T',
          rows: [
            ['Fecha', 'Monto'],
            ['2026-10-01', 85000]
          ],
          columnFormats: [null, 'currency']
        }
      ]
    }
    const buf = await renderXlsx(spec)
    const wb = XLSX.read(buf, { type: 'buffer', cellStyles: true })
    expect(wb.Sheets.T['A2'].z ?? 'General').toBe('General')
    expect(wb.Sheets.T['B2'].z).toBe('"$"#,##0')
  })
})
