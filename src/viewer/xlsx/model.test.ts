import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { read, type WorkSheet } from 'xlsx'
import { DEFAULT_COL_WIDTH_PX, DEFAULT_ROW_HEIGHT_PX, colLetter, sheetToGrid, workbookToGrid } from './model'

const fixture = (name: string): Buffer => readFileSync(fileURLToPath(new URL(`../__fixtures__/${name}`, import.meta.url)))

function emptySheet(ref: string, data: unknown[][] = []): WorkSheet {
  return { '!ref': ref, '!data': data } as unknown as WorkSheet
}

describe('workbookToGrid / sheetToGrid con un xlsx real (de la skill xlsx, sin dependencias)', () => {
  const wb = read(fixture('sample.xlsx'), { type: 'buffer', dense: true, cellStyles: true, sheetRows: 10000 })
  const grid = workbookToGrid(wb)

  it('una hoja, con el encabezado real y los anchos de columna del archivo', () => {
    expect(grid.sheets).toHaveLength(1)
    const sheet = grid.sheets[0]
    expect(sheet.name).toBe('Ventas')
    expect(sheet.cells[0].map((c) => c.text)).toEqual(['Mes', 'Producto', 'Unidades', 'Precio', 'Total'])
    expect(sheet.colWidthsPx.every((w) => w > 0)).toBe(true)
    expect(sheet.truncated).toBe(false)
  })

  it('una fórmula trae el texto formateado Y la fórmula por separado (para el tooltip)', () => {
    const sheet = grid.sheets[0]
    const totalCell = sheet.cells[1][4]
    expect(totalCell.formula).toBe('C2*D2')
    expect(totalCell.text).toBe('15,000')
  })

  it('el relleno sólido del encabezado se resuelve a un color css', () => {
    const header = grid.sheets[0].cells[0][0]
    expect(header.fill).toBe('#1F3864')
  })
})

describe('sheetToGrid: combinadas, recorte y el caso hostil de !ref gigante', () => {
  it('una celda combinada: solo la esquina superior izquierda no queda "cubierta"', () => {
    const sheet: WorkSheet = {
      '!ref': 'A1:B2',
      '!data': [
        [
          { t: 's', v: 'junto' },
          { t: 's', v: '' }
        ],
        [
          { t: 's', v: '' },
          { t: 's', v: '' }
        ]
      ],
      '!merges': [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }]
    } as unknown as WorkSheet
    const g = sheetToGrid('hoja', sheet)
    expect(g.cells[0][0].covered).toBeUndefined()
    expect(g.cells[0][1].covered).toBe(true)
    expect(g.cells[1][0].covered).toBe(true)
    expect(g.cells[1][1].covered).toBe(true)
    expect(g.merges).toEqual([{ r1: 0, c1: 0, r2: 1, c2: 1 }])
  })

  it('el recorte por sheetRows: !ref declara más filas de las que !data realmente tiene → truncated', () => {
    const sheet = emptySheet(
      'A1:B50000',
      Array.from({ length: 3 }, () => [{ t: 's', v: 'x' }])
    )
    const g = sheetToGrid('hoja', sheet)
    expect(g.rows).toBe(3)
    expect(g.truncated).toBe(true)
  })

  it('un !ref hostil (A1:ZZZ1048576) con casi nada de datos reales no reserva memoria por lo declarado', () => {
    const sheet = emptySheet('A1:ZZZ1048576', [[{ t: 's', v: 'solo esta celda' }]])
    const start = Date.now()
    const g = sheetToGrid('hoja', sheet)
    expect(Date.now() - start).toBeLessThan(200)
    expect(g.rows).toBe(1)
    // las columnas sí consideran lo declarado por !ref (para alinear anchos con Excel), pero las FILAS
    // nunca — reservar ~1 millón de filas vacías es justo la bomba de memoria que se quiere evitar.
    expect(g.rows).toBeLessThan(10)
    expect(g.truncated).toBe(true)
  })

  it('sin !cols/!rows: usa los anchos/altos por defecto', () => {
    const sheet = emptySheet('A1:B2', [
      [
        { t: 's', v: 'a' },
        { t: 's', v: 'b' }
      ],
      [
        { t: 's', v: 'c' },
        { t: 's', v: 'd' }
      ]
    ])
    const g = sheetToGrid('hoja', sheet)
    expect(g.colWidthsPx).toEqual([DEFAULT_COL_WIDTH_PX, DEFAULT_COL_WIDTH_PX])
    expect(g.rowHeightsPx).toEqual([DEFAULT_ROW_HEIGHT_PX, DEFAULT_ROW_HEIGHT_PX])
  })

  it('una celda vacía (sin valor) da texto vacío, no "undefined"', () => {
    const sheet = emptySheet('A1:A1', [[{ t: 'z' }]])
    const g = sheetToGrid('hoja', sheet)
    expect(g.cells[0][0].text).toBe('')
  })

  it('una hoja sin !data (vacía del todo) da una grilla de 0x0, no lanza', () => {
    const sheet = { '!ref': 'A1:A1' } as unknown as WorkSheet
    const g = sheetToGrid('hoja', sheet)
    expect(g.rows).toBe(0)
    expect(g.cols).toBe(0)
    expect(g.cells).toEqual([])
  })
})

describe('colLetter', () => {
  it('A, Z, AA, AZ, BA y un caso de tres letras', () => {
    expect(colLetter(0)).toBe('A')
    expect(colLetter(25)).toBe('Z')
    expect(colLetter(26)).toBe('AA')
    expect(colLetter(51)).toBe('AZ')
    expect(colLetter(52)).toBe('BA')
    expect(colLetter(701)).toBe('ZZ')
    expect(colLetter(702)).toBe('AAA')
  })
})
