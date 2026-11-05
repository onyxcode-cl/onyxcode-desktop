import JSZip from 'jszip'
import PptxGenJS from 'pptxgenjs'
import { describe, expect, it } from 'vitest'
import { protectSlide, safeChartOptions, safeHexColor, safeShadow, safeShapeOptions } from './pptx-guards'

describe('1. colores con #', () => {
  it('quita el # y pasa a mayúsculas; descarta lo que no es hex de 6 dígitos', () => {
    expect(safeHexColor('#ff00aa')).toBe('FF00AA')
    expect(safeHexColor('0e2a2f')).toBe('0E2A2F')
    expect(safeHexColor('red')).toBeNull()
    expect(safeHexColor('#fff')).toBeNull()
    expect(safeHexColor(12)).toBeNull()
  })
  it('limpia color, fill, line y chartColors anidados', () => {
    const o = safeShapeOptions({
      color: '#aabbcc',
      fill: { color: '#112233' },
      line: { color: '#445566', width: 2 },
      chartColors: ['#010203', 'FFFFFF']
    }) as any
    expect(o.color).toBe('AABBCC')
    expect(o.fill.color).toBe('112233')
    expect(o.line).toEqual({ color: '445566', width: 2 })
    expect(o.chartColors).toEqual(['010203', 'FFFFFF'])
  })
  it('un color inválido se quita en vez de romper el archivo', () => {
    expect((safeShapeOptions({ color: 'azul' }) as any).color).toBeUndefined()
  })
})

describe('2. sombras con desplazamiento negativo', () => {
  it('offset negativo pasa a positivo y el ángulo gira 180°', () => {
    expect(safeShadow({ type: 'outer', offset: -4, angle: 45, blur: 3 })).toMatchObject({ offset: 4, angle: 225, blur: 3 })
    expect(safeShadow({ offset: -2, angle: 270 })).toMatchObject({ offset: 2, angle: 90 })
  })
  it('limita opacidad a 0–1, blur ≥ 0 y normaliza el color', () => {
    expect(safeShadow({ opacity: 3, blur: -1, color: '#000000' })).toMatchObject({ opacity: 1, blur: 0, color: '000000' })
  })
  it('una sombra normal no cambia', () => {
    expect(safeShadow({ type: 'outer', offset: 3, angle: 90, opacity: 0.4 })).toMatchObject({ offset: 3, angle: 90, opacity: 0.4 })
  })
})

describe('3. etiquetas outEnd en barras apiladas', () => {
  it('stacked y percentStacked pasan a ctr; agrupadas se quedan', () => {
    expect(safeChartOptions('bar', { barGrouping: 'stacked', dataLabelPosition: 'outEnd' }).dataLabelPosition).toBe('ctr')
    expect(safeChartOptions('bar', { barGrouping: 'percentStacked', dataLabelPosition: 'outEnd' }).dataLabelPosition).toBe('ctr')
    expect(safeChartOptions('bar', { barGrouping: 'clustered', dataLabelPosition: 'outEnd' }).dataLabelPosition).toBe('outEnd')
    expect(safeChartOptions('bar', { dataLabelPosition: 'outEnd' }).dataLabelPosition).toBe('outEnd')
  })
  it('también en un gráfico combinado', () => {
    const combo = [
      { type: 'bar', options: { barGrouping: 'stacked', dataLabelPosition: 'outEnd' } },
      { type: 'line', options: {} }
    ]
    safeChartOptions(combo, {})
    expect((combo[0].options as any).dataLabelPosition).toBe('ctr')
  })
})

describe('4. ejes secundarios sin declarar', () => {
  it('declara los dos ejes y el eje de categorías secundario', () => {
    const combo = [
      { type: 'bar', options: {} },
      { type: 'line', options: { secondaryValAxis: true } }
    ]
    const o = safeChartOptions(combo, {})
    expect(o.valAxes).toHaveLength(2)
    expect(o.catAxes).toHaveLength(2)
    expect((o.catAxes as any[])[1]).toEqual({ catAxisHidden: true })
    expect((combo[1].options as any).secondaryCatAxis).toBe(true)
  })
  it('si ya están declarados no los pisa', () => {
    const combo = [{ type: 'line', options: { secondaryValAxis: true, secondaryCatAxis: true } }]
    const va = [{ valAxisTitle: 'A' }, { valAxisTitle: 'B' }]
    expect(safeChartOptions(combo, { valAxes: va, catAxes: [{}, {}] }).valAxes).toEqual(va)
  })
  it('sin ejes secundarios no agrega nada', () => {
    const o = safeChartOptions([{ type: 'bar', options: {} }], {})
    expect(o.valAxes).toBeUndefined()
  })
})

describe('de punta a punta con pptxgenjs real', () => {
  async function build(mutate: (slide: PptxGenJS.Slide) => void): Promise<JSZip> {
    const pres = new PptxGenJS()
    const slide = protectSlide(pres.addSlide())
    mutate(slide)
    return JSZip.loadAsync((await pres.write({ outputType: 'nodebuffer' })) as Buffer)
  }
  it('el archivo no trae # en los colores ni sombras con distancia negativa', async () => {
    const z = await build((s) => {
      s.addText('Hola', {
        x: 1,
        y: 1,
        w: 3,
        h: 1,
        color: '#FF0000',
        shadow: { type: 'outer', offset: -3, angle: 45, color: '#000000', opacity: 0.4, blur: 3 }
      })
      s.addShape('rect', { x: 1, y: 3, w: 2, h: 1, fill: { color: '#00FF00' }, line: { color: '#0000FF' } })
    })
    const xml = await z.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).not.toMatch(/srgbClr val="#/)
    expect(xml).not.toMatch(/dist="-/)
    expect(xml).toContain('FF0000')
  })
  it('barras apiladas con outEnd salen con ctr', async () => {
    const z = await build((s) => {
      s.addChart(
        'bar',
        [
          { name: 'A', labels: ['x', 'y'], values: [1, 2] },
          { name: 'B', labels: ['x', 'y'], values: [2, 3] }
        ],
        {
          x: 1,
          y: 1,
          w: 6,
          h: 4,
          barGrouping: 'stacked',
          showValue: true,
          dataLabelPosition: 'outEnd',
          chartColors: ['#336699', '#CC6600']
        } as any
      )
    })
    const chartFile = Object.keys(z.files).find((n) => /ppt\/charts\/chart\d+\.xml$/.test(n))!
    const xml = await z.file(chartFile)!.async('string')
    expect(xml).not.toContain('dLblPos val="outEnd"')
    expect(xml).not.toMatch(/srgbClr val="#/)
  })
})
