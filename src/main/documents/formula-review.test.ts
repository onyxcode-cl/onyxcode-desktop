import { describe, expect, it } from 'vitest'
import type { XlsxSpec } from '@shared/chat-doc-spec'
import { literalNumbers, parseRefs, reviewFormulas } from './formula-review'

const f = (formula: string, value: number | string = 0) => ({ formula, value })
const sheet = (rows: XlsxSpec['sheets'][0]['rows'], name = 'Ventas') => ({ name, rows })
const rules = (spec: XlsxSpec): string[] => reviewFormulas(spec).map((x) => `${x.rule}@${x.cell}`)

describe('lectura de fórmulas', () => {
  it('referencias y rangos con y sin hoja, e ignora cadenas', () => {
    const r = parseRefs('SUM(Ventas!A1:A9)+\'Mi hoja\'!B3+"C9"')
    expect(r.map((x) => [x.sheet, x.text])).toEqual([
      ['Ventas', 'Ventas!A1:A9'],
      ['Mi hoja', "'Mi hoja'!B3"]
    ])
  })
  it('números sueltos: no cuenta los de las referencias ni los de las cadenas', () => {
    expect(literalNumbers('B2*1.19+A10')).toEqual([1.19])
    expect(literalNumbers('IF(A1="200",0.5,3)')).toEqual([0.5, 3])
    expect(literalNumbers('ROUND(B2/C2,2)')).toEqual([2])
  })
})

describe('referencias rotas', () => {
  it('#REF!, hoja inexistente, celda fuera de los datos y referencia circular', () => {
    const spec: XlsxSpec = {
      sheets: [
        sheet([
          ['a', 'b'],
          [1, f('#REF!+1')],
          [2, f('SUM(Otra!A1:A3)')],
          [3, f('Z99')],
          [4, f('B5')],
          [5, 6]
        ])
      ]
    }
    const r = rules(spec)
    expect(r).toContain('ref-rota@B2')
    expect(r).toContain('ref-rota@B3')
    expect(r).toContain('ref-rota@B4')
    expect(r).toContain('ref-rota@B5')
  })
  it('un rango que se pasa del final de los datos', () => {
    const spec: XlsxSpec = { sheets: [sheet([['x'], [1], [2], [f('SUM(A2:A20)', 3)]])] }
    expect(reviewFormulas(spec).some((x) => x.rule === 'ref-rota' && /se pasa del final/.test(x.message))).toBe(true)
  })
  it('referencias válidas entre hojas pasan', () => {
    const spec: XlsxSpec = { sheets: [sheet([['x'], [1], [2]], 'Datos'), sheet([['t'], [f('SUM(Datos!A2:A3)', 3)]], 'Resumen')] }
    expect(reviewFormulas(spec).filter((x) => x.severity === 'error')).toEqual([])
  })
})

describe('rangos corridos', () => {
  const data = [
    ['Región', 'Ventas'],
    ['N', 10],
    ['C', 20],
    ['S', 30]
  ]
  it('el SUM se queda corto: no llega a la fila de arriba del total', () => {
    const spec: XlsxSpec = { sheets: [sheet([...data, ['Total', f('SUM(B2:B3)', 30)]])] }
    const hit = reviewFormulas(spec).find((x) => x.rule === 'rango-corrido')
    expect(hit?.cell).toBe('B5')
    expect(hit?.message).toContain('quedó corto')
  })
  it('el SUM parte tarde y deja fuera un dato', () => {
    const spec: XlsxSpec = { sheets: [sheet([...data, ['Total', f('SUM(B3:B4)', 50)]])] }
    expect(reviewFormulas(spec).some((x) => x.rule === 'rango-corrido' && /parte tarde/.test(x.message))).toBe(true)
  })
  it('un rango completo no se marca (ni empezando bajo el encabezado)', () => {
    const spec: XlsxSpec = { sheets: [sheet([...data, ['Total', f('SUM(B2:B4)', 60)]])] }
    expect(reviewFormulas(spec)).toEqual([])
  })
})

describe('totales que no cuadran', () => {
  it('el valor del total no es la suma de las filas', () => {
    const spec: XlsxSpec = {
      sheets: [
        sheet([
          ['R', 'V'],
          ['N', 10],
          ['C', 20],
          ['Total', f('SUM(B2:B3)', 99)]
        ])
      ]
    }
    const hit = reviewFormulas(spec).find((x) => x.rule === 'total-descuadrado')
    expect(hit?.message).toContain('99')
    expect(hit?.message).toContain('30')
  })
  it('un total correcto, o una fila que no es de total, no se marca', () => {
    expect(
      reviewFormulas({
        sheets: [
          sheet([
            ['R', 'V'],
            ['N', 10],
            ['C', 20],
            ['Total', f('SUM(B2:B3)', 30)]
          ])
        ]
      })
    ).toEqual([])
    expect(
      reviewFormulas({
        sheets: [
          sheet([
            ['R', 'V'],
            ['N', 10],
            ['C', 20],
            ['Otro', f('SUM(B2:B3)', 99)]
          ])
        ]
      }).some((x) => x.rule === 'total-descuadrado')
    ).toBe(false)
  })
  it('suma los valores de las celdas con fórmula de arriba', () => {
    const spec: XlsxSpec = {
      sheets: [
        sheet([
          ['R', 'V'],
          ['N', f('2*5', 10)],
          ['C', 20],
          ['Total', f('SUM(B2:B3)', 30)]
        ])
      ]
    }
    expect(reviewFormulas(spec).some((x) => x.rule === 'total-descuadrado')).toBe(false)
  })
})

describe('constantes pegadas', () => {
  it('1,19 dentro de la fórmula es un aviso; ×2, ×100, ROUND(…,2) y los enteros chicos no', () => {
    const spec: XlsxSpec = {
      sheets: [
        sheet([
          ['a', 'b'],
          [100, f('A2*1.19')],
          [100, f('A3*2')],
          [100, f('A4/100')],
          [100, f('ROUND(A5/3,2)')],
          [100, f('A6*0.19')]
        ])
      ]
    }
    const r = reviewFormulas(spec).filter((x) => x.rule === 'constante-pegada')
    expect(r.map((x) => x.cell).sort()).toEqual(['B2', 'B6'])
    expect(r.every((x) => x.severity === 'warning')).toBe(true)
  })
  it('el número dentro de una cadena o una referencia no cuenta', () => {
    const spec: XlsxSpec = {
      sheets: [
        sheet([
          ['a', 'b'],
          [1, f('IF(A2="1200",1,0)')]
        ])
      ]
    }
    expect(reviewFormulas(spec).some((x) => x.rule === 'constante-pegada')).toBe(false)
  })
})

describe('IFERROR que tapa errores', () => {
  it('IFERROR e IFNA dan aviso', () => {
    const spec: XlsxSpec = {
      sheets: [
        sheet([
          ['a', 'b'],
          [4, f('IFERROR(10/A2,0)')],
          [0, f('ifna(VLOOKUP(A3,A2:A3,1,0),"")')]
        ])
      ]
    }
    const r = reviewFormulas(spec).filter((x) => x.rule === 'iferror-oculta')
    expect(r.map((x) => x.cell)).toEqual(['B2', 'B3'])
    expect(r[0].severity).toBe('warning')
  })
})

describe('hojas limpias', () => {
  it('un presupuesto bien armado no da ningún hallazgo', () => {
    const spec: XlsxSpec = {
      sheets: [
        sheet([
          ['Concepto', 'Cantidad', 'Precio', 'Subtotal'],
          ['A', 2, 1500, f('B2*C2', 3000)],
          ['B', 3, 2000, f('B3*C3', 6000)],
          ['C', 1, 500, f('B4*C4', 500)],
          ['Total', f('SUM(B2:B4)', 6), f('SUM(C2:C4)', 4000), f('SUM(D2:D4)', 9500)]
        ])
      ]
    }
    expect(reviewFormulas(spec)).toEqual([])
  })
})
