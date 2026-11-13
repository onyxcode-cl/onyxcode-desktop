import { describe, expect, it } from 'vitest'
import { chartCategory, numericCell, numericSeries, prepareSlide } from './deck-data'
import { chatDeckCommands, renderChatDeck } from './chat-deck'
import JSZip from 'jszip'
import type { PptxSpec } from '@shared/chat-doc-spec'
import { resolveDocumentIdentity } from '@shared/document-identity'

describe('datos que el modelo ya entrega', () => {
  it('lee cifras completas locales sin interpretar fechas, rangos ni prosa', () => {
    expect(numericCell('$4.074.900')?.value).toBe(4074900)
    expect(numericCell('CLP 1.234,50')?.value).toBe(1234.5)
    expect(numericCell('35 %')?.value).toBe(35)
    expect(numericCell('-12.5')?.value).toBe(-12.5)
    for (const text of ['15 de diciembre de 2026', '2026-01-15', 'entre 12 y 18', '18 oficinas y 240 familias', 'NaN'])
      expect(numericCell(text)).toBeUndefined()
  })

  it('promueve viñetas incluso con layout bullets y conserva cifras, notas y entrada', () => {
    const slide = {
      title: 'Ventas',
      layout: 'bullets' as const,
      bullets: ['Enero: $4.074.900', 'Febrero: $3.524.150'],
      speaker_notes: 'Fuente'
    }
    const copy = structuredClone(slide)
    const result = prepareSlide(slide, 1, 3)
    expect(result.table?.rows).toEqual([
      ['Enero', '$4.074.900'],
      ['Febrero', '$3.524.150']
    ])
    expect(result.chart?.values).toEqual([4074900, 3524150])
    expect(result.speaker_notes).toBe('Fuente')
    expect(slide).toEqual(copy)
  })

  it('mezcla de unidades y calendario se mantienen como tabla sin gráfico inventado', () => {
    expect(prepareSlide({ bullets: ['Presupuesto: $90.000.000', 'Ejecución: 35 %'] }, 1, 3).chart).toBeUndefined()
    expect(
      numericSeries({
        columns: ['Hito', 'Fecha'],
        rows: [
          ['Simulacro', '15 de diciembre de 2026'],
          ['Entrega', '30 de noviembre de 2026']
        ]
      })
    ).toBeUndefined()
    expect(
      numericSeries({
        columns: ['Cliente', 'Venta'],
        rows: [
          ['C10', '$842.375'],
          ['C08', '$785.300']
        ]
      })?.values
    ).toEqual([842375, 785300])
  })

  it('cifras independientes y meses contra trimestres nunca se convierten en una comparación', () => {
    const mixed = ['Ventas netas de febrero en Norte: $1.188.200', 'Devoluciones totales del trimestre: $116.525']
    const slide = prepareSlide({ title: 'Resultados del cruce', bullets: mixed }, 1, 3)
    expect(slide.layout).toBe('kpis')
    expect(slide.kpis?.map((kpi) => kpi.value)).toEqual(['$1.188.200', '$116.525'])
    expect(slide.table).toBeUndefined()
    expect(slide.chart).toBeUndefined()
    for (const columns of [
      ['Concepto', 'Valor'],
      ['Mes', 'Ventas']
    ]) {
      expect(
        numericSeries({
          columns,
          rows: [
            ['Ventas de febrero', '$1.188.200'],
            ['Devoluciones del trimestre', '$116.525']
          ]
        })
      ).toBeUndefined()
      expect(
        numericSeries({
          columns,
          rows: [
            ['2026-02', '$1.188.200'],
            ['T1 2026', '$116.525']
          ]
        })
      ).toBeUndefined()
    }
    const indicators = {
      kpis: [
        { label: 'Presupuesto', value: '$90.000.000' },
        { label: 'Avance', value: '35 %' }
      ]
    }
    expect(prepareSlide(indicators, 1, 3)).toBe(indicators)
    expect(chartCategory('Devoluciones totales del trimestre')).toBe('Devoluciones totales…')
  })

  it('conserva lienzo libre y portada explícitos; reconoce un cierre sin layout', () => {
    for (const layout of ['free', 'cover', 'closing'] as const) {
      const slide = { layout, bullets: ['A: 10', 'B: 20'] }
      expect(prepareSlide(slide, 0, 1)).toBe(slide)
    }
    expect(prepareSlide({ title: 'Próximos pasos', bullets: ['Revisar'] }, 2, 3).layout).toBe('closing')
    const many = { title: 'Próximos pasos', bullets: ['Uno', 'Dos', 'Tres', 'Cuatro'] }
    expect(prepareSlide(many, 2, 3)).toBe(many) // el cierre breve no debe descartar la cuarta acción
  })
})

type Box = [number, number, number, number]
/** Unión, sin sumar dos veces solapamientos ni contar círculos/fondos/formas decorativas. */
function occupiedArea(boxes: Box[]): number {
  const xs = [...new Set(boxes.flatMap(([x, , w]) => [Math.max(0, x), Math.min(960, x + w)]))].sort((a, b) => a - b)
  let area = 0
  for (let i = 1; i < xs.length; i++) {
    const intervals = boxes
      .filter(([x, , w]) => x < xs[i] && x + w > xs[i - 1])
      .map(([, y, , h]) => [Math.max(0, y), Math.min(540, y + h)])
      .sort((a, b) => a[0] - b[0])
    let end = 0
    for (const [top, bottom] of intervals) {
      area += (xs[i] - xs[i - 1]) * Math.max(0, bottom - Math.max(top, end))
      end = Math.max(end, bottom)
    }
  }
  return area / (960 * 540)
}

describe('ocupación por defecto y objetos editables', () => {
  it('reinicia la selección de tabla antes de las opciones en cada lámina', () => {
    const commands = chatDeckCommands({
      slides: [
        {
          title: 'A',
          kpis: [
            { label: 'Oficinas', value: '18' },
            { label: 'Familias', value: '240' }
          ]
        },
        { title: 'B', table: { columns: ['Hito', 'Responsable'], rows: [['Simulacro', 'Elena']] } }
      ]
    })
    commands.forEach((command, i) => {
      if (command.startsWith('table.options=')) expect(commands[i - 1]).toMatch(/^table.selectCells=/)
    })
  })

  it.skipIf(!process.env.DECKCRAFT_CLI)('exporta varias tablas seguidas y gráficos con los datos reales en OOXML', async () => {
    const bytes = await renderChatDeck(process.env.DECKCRAFT_CLI!, {
      slides: [
        {
          title: 'Cobertura',
          kpis: [
            { label: 'Oficinas', value: '18' },
            { label: 'Familias', value: '240' }
          ],
          bullets: ['Conservar evidencia']
        },
        { title: 'Ventas', bullets: ['Enero: $4.074.900', 'Febrero: $3.524.150'] },
        {
          title: 'Clientes',
          table: {
            columns: ['Cliente', 'Monto'],
            rows: [
              ['C10', '$842.375'],
              ['C08', '$785.300']
            ]
          }
        },
        { title: 'Decisión', layout: 'bullets', bullets: ['Aprobar dos depósitos de agua', 'Resolver antes del 30 de noviembre'] }
      ]
    })
    const zip = await JSZip.loadAsync(bytes)
    const slides = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async('string'))
    )
    expect(slides).toHaveLength(4)
    expect(slides.slice(1, 3).every((xml) => xml.includes('<a:tbl>') && xml.includes('<p:ph type="title"/>'))).toBe(true)
    expect(slides[0]).not.toContain('<a:tbl>')
    expect(slides.join('')).toContain('Conservar evidencia')
    const enero = [...slides[1].matchAll(/<a:tc>[\s\S]*?<\/a:tc>/g)].find((cell) => cell[0].includes('Enero'))![0]
    expect(enero).toContain(`val="${resolveDocumentIdentity({ slides: [{ title: 'Cobertura' }] }).palette.text.slice(1)}"`) // cuerpo legible; format.color del encabezado no debe teñirlo de blanco
    const boxes = [...slides[3].matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].flatMap((shape): Box[] => {
      if (!/<a:t>[^<]+<\/a:t>/.test(shape[0])) return []
      const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(shape[0])
      const ext = /<a:ext cx="(\d+)" cy="(\d+)"/.exec(shape[0])
      return off && ext ? [[Number(off[1]) / 12700, Number(off[2]) / 12700, Number(ext[1]) / 12700, Number(ext[2]) / 12700]] : []
    })
    // También en los bytes finales: una caja que DeckCraft encoge en la exportación no cumple.
    expect(occupiedArea(boxes)).toBeGreaterThanOrEqual(0.42)
    expect(slides[3]).toContain('<a:noAutofit/>')
    const charts = await Promise.all(
      Object.keys(zip.files)
        .filter((name) => /^ppt\/charts\/chart\d+\.xml$/.test(name))
        .map((name) => zip.file(name)!.async('string'))
    )
    expect(charts).toHaveLength(2)
    expect(charts.every((xml) => xml.includes('formatCode="#,##0.########" sourceLinked="0"'))).toBe(true)
    expect(slides[1]).toContain('4.074.900')
    for (const value of [4074900, 3524150, 842375, 785300]) expect(charts.join('')).toContain(`<c:v>${value}</c:v>`)
  })

  it('el cuerpo no vuelve a un bloque arriba: ≥42% del lienzo sin fondos ni decoración', () => {
    const slides: PptxSpec['slides'] = [
      { title: 'Decisión pendiente', layout: 'bullets', bullets: ['Aprobar dos depósitos de agua', 'Resolver antes del 30 de noviembre'] },
      {
        title: 'Agua',
        columns: [
          { heading: 'Riesgo', bullets: ['Interrupción del suministro de agua'] },
          { heading: 'Reserva', bullets: ['72 horas de agua disponibles'] }
        ]
      },
      {
        title: 'Cobertura',
        kpis: [
          { label: 'Oficinas', value: '18' },
          { label: 'Familias', value: '240' }
        ]
      },
      { title: 'Ventas', bullets: ['Enero: $4.074.900', 'Febrero: $3.524.150', 'Marzo: $3.570.525'] }
    ]
    for (const slide of slides) {
      const commands = chatDeckCommands({ slides: [{ title: 'Portada' }, slide] })
      const start = commands.findLastIndex((c) => c.startsWith('slide.new='))
      const boxes = commands.slice(start).flatMap((c): Box[] => {
        if (!/^(insert.textBox|insert.table|insert.chart)=/.test(c)) return []
        const { rect, text } = JSON.parse(c.slice(c.indexOf('=') + 1))
        return text === '' || rect[1] >= 490 ? [] : [rect]
      })
      expect(occupiedArea(boxes), slide.title).toBeGreaterThanOrEqual(0.42)
    }
  })

  it('una tabla de una fila tiene alto natural, se centra y no rellena datos de gris', () => {
    const commands = chatDeckCommands({
      slides: [
        {
          title: 'Calendario',
          table: {
            columns: ['Hito', 'Fecha', 'Responsable'],
            rows: [['Simulacro de continuidad', '15 de diciembre de 2026', 'Elena Soto']]
          }
        }
      ]
    })
    const command = commands.find((c) => c.startsWith('insert.table='))!
    const { rows, rect } = JSON.parse(command.slice(command.indexOf('=') + 1))
    expect(rows).toBe(2)
    expect(rect[3]).toBeLessThan(200)
    expect(rect[1]).toBeGreaterThan(200)
    expect(rect[1] + rect[3] / 2).toBeCloseTo(315)
    expect(commands).toContain('table.options={"headerRow":true,"bandedRows":false}')
    expect(
      commands.some(
        (c) => c.startsWith('table.cellFill=') && c.includes(resolveDocumentIdentity({ slides: [{ title: 'Calendario' }] }).palette.bg)
      )
    ).toBe(true)
  })

  it('la identidad se deriva sin opciones y el texto breve crece y queda centrado en su espacio', () => {
    const spec: PptxSpec = {
      slides: [{ title: 'Portada' }, { title: 'Decisión', layout: 'bullets', bullets: ['Aprobar depósitos'] }]
    }
    const commands = chatDeckCommands(spec)
    const palette = resolveDocumentIdentity(spec).palette
    expect(commands).toContain(`design.background={"color":"${palette.bg}"}`)
    expect(commands.some((c) => c.startsWith('design.colors=') && c.includes(palette.accent))).toBe(true)
    const index = commands.findIndex((c) => c.startsWith('insert.textBox=') && c.includes('Aprobar depósitos'))
    expect(JSON.parse(commands[index + 1].split('=')[1]).size).toBeGreaterThanOrEqual(50)
    const next = commands.findIndex((command, i) => i > index && /^(insert\.|slide\.)/.test(command))
    expect(commands.slice(index, next < 0 ? undefined : next)).toContain('format.anchor={"anchor":"middle"}')
  })
})
