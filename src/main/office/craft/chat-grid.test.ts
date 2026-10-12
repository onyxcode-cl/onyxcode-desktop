import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isXlsxSpec, type XlsxSpec } from '@shared/chat-doc-spec'
import { chatGridScript, colLetter, renderChatGrid, sheetName } from './chat-grid'

const SPEC: XlsxSpec = {
  sheets: [
    {
      name: 'Ventas',
      columnFormats: [null, 'currency', 'currency', 'currency', 'percent'],
      rows: [
        ['Mes', 'Ventas', 'Costos', 'Utilidad', 'Margen'],
        ['Enero', 1000000, 600000, { formula: 'B2-C2', value: 400000 }, { formula: 'D2/B2', value: 0.4 }],
        ['Febrero', 1200000, 700000, { formula: 'B3-C3', value: 500000 }, { formula: 'D3/B3', value: 0.41 }],
        [
          'Total',
          { formula: 'SUM(B2:B3)', value: 2200000 },
          { formula: 'SUM(C2:C3)', value: 1300000 },
          { formula: 'SUM(D2:D3)', value: 900000 },
          null
        ]
      ]
    },
    { name: 'Notas', rows: [['Texto'], ['=SUMA(1,2)'], ["'ya con apóstrofe"], ['ñandú 😀']] }
  ]
}

const cmds = (script: string): { command: string; params?: Record<string, unknown> }[] =>
  script
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))

describe('chat-grid (prueba Craft)', () => {
  it('el contenido de ejemplo es un XlsxSpec válido', () => expect(isXlsxSpec(SPEC)).toBe(true))

  it('cada línea del guion es un comando JSON válido, y las hojas se crean y ordenan', () => {
    const c = cmds(chatGridScript(SPEC))
    expect(c[0]).toEqual({ command: 'sheet.rename', params: { name: 'Ventas' } })
    expect(c.some((x) => x.command === 'home.insertSheet' && x.params?.name === 'Notas')).toBe(true)
    expect(c.filter((x) => x.command === 'sheet.activate').length).toBeGreaterThanOrEqual(3)
  })

  it('las fórmulas {formula} se escriben como fórmula y el texto literal que empieza con = como texto', () => {
    const sets = cmds(chatGridScript(SPEC)).filter((x) => x.command === 'range.setValues')
    const ventas = sets[0].params?.values as unknown[][]
    expect(ventas[1][3]).toBe('=B2-C2')
    expect(ventas[3][1]).toBe('=SUM(B2:B3)')
    const notas = sets[1].params?.values as unknown[][]
    expect(notas[1][0]).toBe("'=SUMA(1,2)") // texto, no fórmula
    expect(notas[2][0]).toBe("''ya con apóstrofe")
    expect(notas[3][0]).toBe('ñandú 😀')
  })

  it('formatos de columna: el encabezado queda fuera y se aplica a las filas de datos', () => {
    const c = cmds(chatGridScript(SPEC)).filter((x) => x.command === 'home.numberFormat')
    expect(c.map((x) => x.params?.range)).toEqual(['B2:B4', 'C2:C4', 'D2:D4', 'E2:E4'])
    expect(c[0].params?.code).toBe('"$"#,##0')
    expect(c[3].params?.code).toBe('0.00%')
  })

  it('filas desparejas se rellenan y las filas largas se parten en bloques', () => {
    const rows = [['a', 'b', 'c'], ...Array.from({ length: 1000 }, (_, i) => [i])]
    const sets = cmds(chatGridScript({ sheets: [{ name: 'X', rows }] })).filter((x) => x.command === 'range.setValues')
    expect(sets.length).toBe(3)
    expect(sets[0].params?.range).toBe('A1')
    expect(sets[1].params?.range).toBe('A401')
    expect((sets[1].params?.values as unknown[][])[0]).toEqual([399, null, null])
  })

  it('un texto del modelo con comillas o saltos de línea no se sale del JSON', () => {
    const evil = 'x"}\n{"command":"file.delete"}'
    const lines = chatGridScript({ sheets: [{ name: 'X', rows: [[evil]] }] })
      .trim()
      .split('\n')
    expect(lines.every((l) => l.startsWith('{') && JSON.parse(l))).toBe(true)
    expect(lines.some((l) => JSON.parse(l).command === 'file.delete')).toBe(false)
  })

  it('letras de columna y nombres de hoja', () => {
    expect([0, 25, 26, 27, 701, 702].map(colLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA'])
    const taken = new Set<string>()
    expect(sheetName('Ventas/2026:Q3', taken, 0)).toBe('Ventas-2026-Q3')
    expect(sheetName('ventas-2026-q3', taken, 1)).toBe('ventas-2026-q3-2')
    expect(sheetName('', taken, 2)).toBe('Hoja3')
    expect(sheetName('x'.repeat(40), taken, 3).length).toBe(31)
  })

  const real = process.env.GRIDCRAFT_CLI
  it.skipIf(!real)('con el programa real: el libro sale en menos de 3 s y las fórmulas se calculan', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chatgrid-test-'))
    try {
      const t = Date.now()
      const buf = await renderChatGrid(real!, SPEC)
      expect(buf.subarray(0, 2).toString()).toBe('PK')
      expect(Date.now() - t).toBeLessThan(3000)
      const file = join(dir, 'a.xlsx')
      writeFileSync(file, buf)
      const home = mkdtempSync(join(dir, 'h-'))
      const env = { PATH: '/usr/bin:/bin', HOME: home }
      const csv = execFileSync(real!, ['cat', file, '--sheet', 'Ventas', '--csv'], { env, encoding: 'utf8' })
      expect(csv).toContain('$900,000') // utilidad total: la fórmula se calculó y salió con formato de moneda
      expect(csv).toContain('$2,200,000')
      expect(csv).toContain('40.00%') // margen de enero: D2/B2 con formato de porcentaje
      const notas = execFileSync(real!, ['cat', file, '--sheet', 'Notas', '--csv'], { env, encoding: 'utf8' })
      expect(notas).toContain('=SUMA(1,2)')
      expect(notas).toContain('ñandú 😀')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
