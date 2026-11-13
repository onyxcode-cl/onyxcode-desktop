import { resolveDocumentIdentity } from '@shared/document-identity'
import { customPalette } from '../office/craft/deck-kit'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { isPptxSpec, renderPptx, type PptxSpec } from './render-pptx'
import { THEMES } from './pptx-design'

describe('isPptxSpec', () => {
  it('acepta una especificación válida (una o más diapositivas con título/viñetas opcionales)', () => {
    expect(isPptxSpec({ slides: [{ title: 'Portada' }, { title: 'Detalle', bullets: ['uno', 'dos'] }] })).toBe(true)
  })

  it('rechaza sin diapositivas', () => {
    expect(isPptxSpec({ slides: [] })).toBe(false)
  })

  it('rechaza una viñeta que no sea texto', () => {
    expect(isPptxSpec({ slides: [{ bullets: [42] }] })).toBe(false)
  })

  it('rechaza cualquier cosa que no tenga la forma esperada', () => {
    expect(isPptxSpec(null)).toBe(false)
    expect(isPptxSpec({})).toBe(false)
  })

  it('acepta un theme/layout válido, rechaza uno inventado', () => {
    expect(isPptxSpec({ theme: 'dark', slides: [{ title: 'X', layout: 'section' }] })).toBe(true)
    expect(isPptxSpec({ theme: 'fucsia', slides: [{ title: 'X' }] })).toBe(false)
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'collage' }] })).toBe(false)
  })

  it('acepta un "chart" bien formado, rechaza uno con categories/values de largo distinto o un tipo inventado', () => {
    const base = { title: 'Ventas', layout: 'chart', chart: { type: 'bar', categories: ['Ene', 'Feb'], values: [10, 20] } }
    expect(isPptxSpec({ slides: [base] })).toBe(true)
    expect(isPptxSpec({ slides: [{ ...base, chart: { ...base.chart, values: [10] } }] })).toBe(false)
    expect(isPptxSpec({ slides: [{ ...base, chart: { ...base.chart, type: 'donut' } }] })).toBe(false)
    expect(isPptxSpec({ slides: [{ ...base, chart: { ...base.chart, values: ['10', '20'] } }] })).toBe(false)
  })

  it('acepta eyebrow/note en una diapositiva y footer en el deck; rechaza si se pasan del largo', () => {
    expect(isPptxSpec({ footer: 'Empresa · Q3', slides: [{ title: 'X', eyebrow: 'Informe', note: 'Cifras en miles' }] })).toBe(true)
    expect(isPptxSpec({ slides: [{ title: 'X', eyebrow: 'x'.repeat(41) }] })).toBe(false)
    expect(isPptxSpec({ slides: [{ title: 'X', note: 'x'.repeat(141) }] })).toBe(false)
    expect(isPptxSpec({ footer: 'x'.repeat(61), slides: [{ title: 'X' }] })).toBe(false)
  })

  it('acepta "columns" (exactamente 2, cada una con bullets) en two-col; rechaza 1 o 3 columnas', () => {
    const cols = (n: number): unknown => Array.from({ length: n }, (_, i) => ({ heading: `Col ${i}`, bullets: ['x'] }))
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'two-col', columns: cols(2) }] })).toBe(true)
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'two-col', columns: cols(1) }] })).toBe(false)
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'two-col', columns: cols(3) }] })).toBe(false)
  })

  it('acepta "kpis" (2 a 4 métricas, cada una label+value y delta opcional); rechaza menos de 2, más de 4, o una sin label/value', () => {
    const kpis = (n: number): unknown => Array.from({ length: n }, (_, i) => ({ label: `Métrica ${i}`, value: '42%' }))
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'kpis', kpis: kpis(2) }] })).toBe(true)
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'kpis', kpis: kpis(4) }] })).toBe(true)
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'kpis', kpis: kpis(1) }] })).toBe(false)
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'kpis', kpis: kpis(5) }] })).toBe(false)
    expect(isPptxSpec({ slides: [{ title: 'X', layout: 'kpis', kpis: [{ value: '42%' }, { label: 'Y', value: '1' }] }] })).toBe(false)
    expect(
      isPptxSpec({
        slides: [
          {
            title: 'X',
            layout: 'kpis',
            kpis: [
              { label: 'X', value: '1', delta: '+5%' },
              { label: 'Y', value: '2' }
            ]
          }
        ]
      })
    ).toBe(true)
  })
})

describe('cierres y frases breves del respaldo', () => {
  it('un Gracias sin viñetas y una frase sola quedan grandes y centrados, con contacto conservado', async () => {
    const slides = await slideTexts(
      await renderPptx({
        slides: [
          { title: 'Inicio' },
          { title: 'El agua es vida', layout: 'bullets' },
          { title: 'Gracias', layout: 'bullets', note: 'equipo@example.test' }
        ]
      })
    )
    for (const i of [1, 2]) {
      expect(slides[i]).toContain('algn="ctr"')
      expect(slides[i]).toMatch(/sz="(?:7200|8000)"/)
    }
    expect(slides[2]).toContain('equipo@example.test')
  })
})

async function slideTexts(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf)
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const out: string[] = []
  for (const name of names) out.push(await zip.file(name)!.async('string'))
  return out
}

/** Los gráficos (`addChart`) viven en su propia parte del zip (`ppt/charts/chartN.xml`), no en la del slide. */
async function chartTexts(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf)
  const names = Object.keys(zip.files).filter((n) => /^ppt\/charts\/chart\d+\.xml$/.test(n))
  const out: string[] = []
  for (const name of names) out.push(await zip.file(name)!.async('string'))
  return out
}

function bgPattern(hex: string): string {
  return `<p:bgPr><a:solidFill><a:srgbClr val="${hex}"/></a:solidFill></p:bgPr>`
}

describe('renderPptx: genera un .pptx real, releíble', () => {
  it('una diapositiva por entrada de `slides`', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Portada' }, { title: 'Detalle', bullets: ['Primer punto', 'Segundo punto'] }] }
    const buf = await renderPptx(spec)
    expect(buf.subarray(0, 2).toString()).toBe('PK') // firma de archivo zip (.pptx es un zip)
    const texts = await slideTexts(buf)
    expect(texts).toHaveLength(2)
    expect(texts[0]).toContain('Portada')
    expect(texts[1]).toContain('Detalle')
    expect(texts[1]).toContain('Primer punto')
    expect(texts[1]).toContain('Segundo punto')
  })

  it('tildes/eñes del texto llegan intactas al xml de la diapositiva', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Cotización', bullets: ['Año 2026', 'Ñandú'] }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect(text).toContain('Cotización')
    expect(text).toContain('Año 2026')
    expect(text).toContain('Ñandú')
  })

  it('los fondos del respaldo se derivan de la identidad y el contenido conserva su fondo', async () => {
    const spec: PptxSpec = {
      slides: [
        { title: 'Portada' },
        { title: 'Sección' },
        { title: '80%', bullets: ['x'], layout: 'stat' },
        { title: 'Cierre', layout: 'closing' },
        { title: 'Detalle', bullets: ['uno', 'dos'] }
      ]
    }
    const buf = await renderPptx(spec)
    const texts = await slideTexts(buf)
    const own = customPalette(resolveDocumentIdentity(spec).palette)
    const primaryBg = bgPattern(own.accent)
    const primary2Bg = bgPattern(own.accent2)
    expect(texts[0]).toContain(primaryBg) // cover
    expect(texts[1]).toContain(primary2Bg) // section
    expect(texts[2]).toContain(primary2Bg) // stat
    expect(texts[3]).toContain(primaryBg) // closing
    expect(texts[4]).not.toContain(primaryBg)
    expect(texts[4]).not.toContain(primary2Bg)
  })

  it('layout explícito gana sobre la inferencia', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Portada con bullets pero forzada a section', bullets: ['x'], layout: 'section' }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect(text).toContain(customPalette(resolveDocumentIdentity(spec).palette).accent2) // "section" usa primary2, aunque sea la diapositiva 0 (que por índice sería portada)
  })

  it('el theme cambia la paleta de todo el deck', async () => {
    const spec: PptxSpec = { theme: 'green', slides: [{ title: 'Portada' }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect(text).toContain(resolveDocumentIdentity(spec).palette.accent.slice(1))
    expect(text).not.toContain(THEMES.blue.primary)
  })

  it('numera las páginas en las diapositivas de contenido ("2 / 3", etc.)', async () => {
    const spec: PptxSpec = {
      slides: [{ title: 'Portada' }, { title: 'A', bullets: ['x'] }, { title: 'B', layout: 'bullets', bullets: ['y'] }]
    }
    const buf = await renderPptx(spec)
    const texts = await slideTexts(buf)
    expect(texts[1]).toContain('2 / 3')
    expect(texts[2]).toContain('3 / 3')
  })

  it('layout "stat": un título "número+unidad" (p.ej. "80%") se separa en dos fragmentos de texto, y el primer bullet es la explicación', async () => {
    const spec: PptxSpec = { slides: [{ title: '80%', bullets: ['de las personas que hacen ejercicio duermen mejor'], layout: 'stat' }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect(text).toContain('<a:t>80</a:t>')
    expect(text).toContain('<a:t>%</a:t>')
    expect(text).toContain('de las personas que hacen ejercicio duermen mejor')
  })

  it('layout "stat": un título que NO es "número+unidad" queda como un solo texto, sin forzar una separación', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Crecimiento sostenido', layout: 'stat' }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect(text).toContain('Crecimiento sostenido')
  })

  it('layout "steps": cada viñeta sale como un paso numerado (un círculo + el número por viñeta)', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Proceso', bullets: ['Primero', 'Segundo', 'Tercero'], layout: 'steps' }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect((text.match(/prst="ellipse"/g) ?? []).length).toBe(3)
    expect(text).toContain('<a:t>1</a:t>')
    expect(text).toContain('<a:t>2</a:t>')
    expect(text).toContain('<a:t>3</a:t>')
    expect(text).toContain('Primero')
    expect(text).toContain('Segundo')
    expect(text).toContain('Tercero')
  })

  it('"Etiqueta: resto" en una viñeta sale con la etiqueta en negrita (bold="1") seguida del resto, en bullets/steps/cards', async () => {
    const spec: PptxSpec = {
      slides: [
        { title: 'A', bullets: ['Soporte: 24/7'], layout: 'bullets' },
        { title: 'B', bullets: ['Lanzar: el programa'], layout: 'steps' },
        { title: 'C', bullets: ['Precio: sin cargos'], layout: 'cards' }
      ]
    }
    const buf = await renderPptx(spec)
    const texts = await slideTexts(buf)
    // el run que contiene "Soporte: " trae b="1" en su <a:rPr> (el de "24/7" NO), ambos en el MISMO
    // párrafo (un solo <a:buChar>, no dos viñetas para una viñeta de origen) — exactamente lo que
    // arregló el bug real: antes los runs con/sin negrita se volvían a juntar en un solo texto plano.
    const run = (text: string, body: string): string | undefined =>
      [...body.matchAll(/<a:r>[\s\S]*?<\/a:r>/g)].map((m) => m[0]).find((r) => r.includes(`<a:t>${text}</a:t>`))
    expect(run('Soporte: ', texts[0])).toMatch(/b="1"/)
    expect(run('24/7', texts[0])).not.toMatch(/b="1"/)
    expect((texts[0].match(/<a:buChar/g) ?? []).length).toBe(1)
    expect(texts[1]).toContain('Lanzar: ')
    expect(texts[2]).toContain('Precio')
  })

  it('ninguna diapositiva tiene una barra/filete RECTANGULAR decorativo (el "hallmark de IA" que se sacó) — círculos de acento sí, a propósito', async () => {
    const spec: PptxSpec = {
      slides: [{ title: 'Portada' }, { title: 'Sección' }, { title: 'A', bullets: ['x'] }, { title: '1', bullets: ['y'], layout: 'stat' }]
    }
    const buf = await renderPptx(spec)
    const texts = await slideTexts(buf)
    for (const text of texts) {
      const shapes = text.match(/<p:sp>[\s\S]*?<\/p:sp>/g) ?? []
      // Una forma puramente decorativa (sin texto adentro) con geometría rectangular es exactamente la
      // barra/filete que marca la skill como "hecho por IA" — no debería existir ninguna. Los círculos
      // nuevos (geometría "ellipse") SÍ son el elemento visual a propósito, no cuentan.
      const hasDecorativeRectBar = shapes.some((sp) => /prst="rect"/.test(sp) && !/<a:t>/.test(sp))
      expect(hasDecorativeRectBar).toBe(false)
    }
  })

  it('el respaldo no añade círculos decorativos fuera del lienzo', async () => {
    const spec: PptxSpec = {
      slides: [{ title: 'Portada' }, { title: 'Sección' }, { title: 'A', bullets: ['x'] }, { title: '80%', bullets: ['y'], layout: 'stat' }]
    }
    const buf = await renderPptx(spec)
    const texts = await slideTexts(buf)
    expect((texts[0].match(/prst="ellipse"/g) ?? []).length).toBe(0) // portada
    expect((texts[1].match(/prst="ellipse"/g) ?? []).length).toBe(0) // sección
    expect((texts[3].match(/prst="ellipse"/g) ?? []).length).toBe(0) // cifra
  })

  it('layout "two-col" SIN "columns": las viñetas se reparten mitad y mitad (compatibilidad con decks ya generados)', async () => {
    const spec: PptxSpec = {
      slides: [
        {
          title: 'Antes y después',
          bullets: ['Antes: manual', 'Antes: lento', 'Después: automático', 'Después: rápido'],
          layout: 'two-col'
        }
      ]
    }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    for (const b of ['Antes: manual', 'Antes: lento', 'Después: automático', 'Después: rápido']) expect(text).toContain(b)
  })

  it('layout "two-col" CON "columns": dos paneles con encabezado propio, el derecho con el fondo invertido (énfasis tipo "antes/después")', async () => {
    const spec: PptxSpec = {
      slides: [
        {
          title: 'Impacto',
          layout: 'two-col',
          columns: [
            { heading: 'Antes', bullets: ['21 días', '30% sin respuesta'] },
            { heading: 'Después', bullets: ['12 días', '8% sin respuesta'] }
          ]
        }
      ]
    }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    for (const t of ['Antes', 'Después', '21 días', '30% sin respuesta', '12 días', '8% sin respuesta']) expect(text).toContain(t)
    expect((text.match(/prst="roundRect"/g) ?? []).length).toBe(2) // los dos paneles
    expect(text).toContain(customPalette(resolveDocumentIdentity(spec).palette).accent2) // panel derecho invertido
  })

  it('layout "cards": cada viñeta sale como una tarjeta numerada (roundRect + círculo con el número + su propio texto)', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Ventajas', bullets: ['Rápido', 'Seguro', 'Simple'], layout: 'cards' }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect((text.match(/prst="roundRect"/g) ?? []).length).toBe(3)
    expect((text.match(/prst="ellipse"/g) ?? []).length).toBe(3)
    for (const b of ['Rápido', 'Seguro', 'Simple']) expect(text).toContain(b)
  })

  it('layout "kpis": tarjetas de métricas independientes, con su etiqueta/número/variación', async () => {
    const spec: PptxSpec = {
      slides: [
        {
          title: 'Resultados',
          layout: 'kpis',
          kpis: [
            { label: 'Ventas totales', value: '$433 M', delta: '+18% vs. trimestre anterior' },
            { label: 'Clientes nuevos', value: '1.240', delta: '+12% vs. trimestre anterior' },
            { label: 'Retención', value: '94%' }
          ]
        }
      ]
    }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect(text).not.toContain('<a:tbl>') // cifras independientes: tarjetas con texto editable
    expect((text.match(/prst="ellipse"/g) ?? []).length).toBe(0) // sin círculo numerado — no es "cards"
    for (const t of ['Ventas totales', '$433 M', '+18% vs. trimestre anterior', 'Clientes nuevos', '1.240', 'Retención', '94%']) {
      expect(text).toContain(t)
    }
  })

  it('layout "kpis" con menos de 2 métricas: cae a "bullets" (nunca una fila de una sola tarjeta)', async () => {
    const spec: PptxSpec = { slides: [{ title: 'X', layout: 'kpis', kpis: [{ label: 'Y', value: '1' }], bullets: ['algo'] }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect((text.match(/prst="roundRect"/g) ?? []).length).toBe(0)
  })

  it('layout "chart": arma un gráfico nativo de verdad, con los colores del tema (categorías/valores en su propia parte del .pptx)', async () => {
    const spec: PptxSpec = {
      slides: [{ title: 'Ventas', layout: 'chart', chart: { type: 'bar', categories: ['Ene', 'Feb', 'Mar'], values: [10, 20, 15] } }]
    }
    const buf = await renderPptx(spec)
    const [slide] = await slideTexts(buf)
    expect(slide).toContain('graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"')
    const [chart] = await chartTexts(buf)
    expect(chart).toBeTruthy()
    for (const cat of ['Ene', 'Feb', 'Mar']) expect(chart).toContain(cat)
    for (const val of ['10', '20', '15']) expect(chart).toContain(`<c:v>${val}</c:v>`)
    expect(chart).toContain(resolveDocumentIdentity(spec).palette.accent.slice(1))
  })

  it('eyebrow/note/footer llegan al xml cuando se dan — y NUNCA se inventa nada si no vienen', async () => {
    const withFields: PptxSpec = {
      footer: 'Empresa Ejemplo · Q3 2026',
      slides: [{ title: 'Portada', eyebrow: 'Informe trimestral', note: 'Cifras en miles de USD' }]
    }
    const [withText] = await slideTexts(await renderPptx(withFields))
    expect(withText).toContain('INFORME TRIMESTRAL') // la etiqueta sale en mayúsculas
    expect(withText).toContain('Cifras en miles de USD') // nota propia de la diapositiva

    const noteless: PptxSpec = { slides: [{ title: 'Portada' }] }
    const [plainText] = await slideTexts(await renderPptx(noteless))
    expect(plainText).not.toContain('INFORME')
    expect(plainText).not.toContain('Cifras')

    const footerFallback: PptxSpec = { footer: 'Empresa Ejemplo · Q3 2026', slides: [{ title: 'Portada' }] }
    const [footerText] = await slideTexts(await renderPptx(footerFallback))
    expect(footerText).toContain('Empresa Ejemplo · Q3 2026') // sin note propia, usa el footer del deck
  })

  it('sección sin "eyebrow": se numera sola ("01", "02"...) en vez de inventar texto', async () => {
    const spec: PptxSpec = {
      slides: [{ title: 'Portada' }, { title: 'Primera sección' }, { title: 'X', bullets: ['y'] }, { title: 'Segunda sección' }]
    }
    const buf = await renderPptx(spec)
    const texts = await slideTexts(buf)
    expect(texts[1]).toContain('<a:t>01</a:t>')
    expect(texts[3]).toContain('<a:t>02</a:t>')
  })

  it('las fuentes propias ganan sobre los ejemplos de tema', async () => {
    const spec: PptxSpec = { fonts: { title: 'Verdana', body: 'Georgia' }, slides: [{ title: 'Título', bullets: ['cuerpo'] }] }
    for (const theme of ['warm', 'dark'] as const) {
      const buffer = await renderPptx({ ...spec, theme })
      expect((await slideTexts(buffer))[0]).toContain('typeface="Verdana"')
      const zip = await JSZip.loadAsync(buffer)
      expect(await zip.file('ppt/theme/theme1.xml')!.async('string')).toContain('typeface="Georgia"')
    }
  })

  it('sin "style": el look es idéntico al de siempre (equivale a "classic") — cero regresión para decks ya generados', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Portada' }, { title: 'X', bullets: ['a'], layout: 'cards' }] }
    const [plain, classic] = await Promise.all([
      slideTexts(await renderPptx(spec)),
      slideTexts(await renderPptx({ ...spec, style: 'classic' }))
    ])
    expect(plain).toEqual(classic)
  })

  it('la identidad de tarjetas determina geometría en el respaldo y no agrega decoración fuera del lienzo', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Portada' }, { title: 'X', layout: 'cards', bullets: ['a', 'b'] }] }
    for (const cards of ['rounded', 'square', 'outline'] as const) {
      const texts = await slideTexts(await renderPptx({ ...spec, identity: { cards } }))
      expect(texts[0]).not.toContain('prst="ellipse"')
      expect(texts[1].includes('prst="roundRect"')).toBe(cards === 'rounded')
      for (const t of ['a', 'b']) expect(texts[1]).toContain(`<a:t>${t}</a:t>`)
    }
  })
})

describe('diapositivas libres con el generador de respaldo', () => {
  it('se simplifican a título + viñetas en vez de quedar vacías', async () => {
    const { degradeFreeSlides } = await import('./render-pptx')
    const out = degradeFreeSlides({
      slides: [
        { title: 'Portada' },
        {
          layout: 'free',
          elements: [
            { type: 'shape', shape: 'ellipse', x: 0, y: 0, w: 10, h: 10, fill: '#FFFFFF' },
            { type: 'text', x: 0, y: 0, w: 100, h: 50, text: 'Grande', size: 60 },
            { type: 'text', x: 0, y: 60, w: 100, h: 50, text: 'Chico', size: 16 }
          ]
        }
      ]
    })
    expect(out.slides[1]).toMatchObject({ title: 'Grande', bullets: ['Chico'], layout: 'bullets' })
  })
})

describe('189: notas del orador en el respaldo (pptxgenjs)', () => {
  it('el texto queda en la nota de su diapositiva y solo ahí', async () => {
    const buf = await renderPptx({
      slides: [
        { title: 'Uno', bullets: ['a'], speaker_notes: 'Notas con ñ' },
        { title: 'Dos', bullets: ['b'] }
      ]
    } as never)
    const zip = await JSZip.loadAsync(buf)
    const notes = Object.keys(zip.files).filter((n) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
    const texts = await Promise.all(notes.map((n) => zip.file(n)!.async('string')))
    expect(texts.filter((t) => t.includes('Notas con ñ'))).toHaveLength(1)
  })
})

describe('V23B: respaldo sin DeckCraft conserva datos y aprovecha la lámina', () => {
  it('una tabla sin layout sale como tabla nativa y gráfico comparable, con libro de datos editable', async () => {
    const buf = await renderPptx({
      slides: [
        {
          title: 'Recursos',
          table: {
            columns: ['Estado', 'Millones'],
            rows: [
              ['Ejecutado', '31,5'],
              ['Disponible', '58,5']
            ]
          }
        }
      ]
    })
    const [xml] = await slideTexts(buf)
    expect(xml).toContain('<a:tbl>')
    expect(xml).toContain('Ejecutado')
    expect(xml).toContain('31,5')
    const charts = await chartTexts(buf)
    expect(charts).toHaveLength(1)
    expect(charts[0]).toContain('<c:v>31.5</c:v>')
    expect(charts[0]).toContain('<c:v>58.5</c:v>')
    const zip = await JSZip.loadAsync(buf)
    expect(Object.keys(zip.files).some((name) => /^ppt\/embeddings\/.*\.xlsx$/.test(name))).toBe(true)
  })

  it('una lista etiqueta-número ya usada por el modelo se convierte sin opciones especiales', async () => {
    const buf = await renderPptx({
      slides: [{ title: 'Informe' }, { title: 'Ventas', bullets: ['Enero: $4.074.900', 'Febrero: $3.524.150'] }]
    })
    const xml = (await slideTexts(buf))[1]
    expect(xml).toContain('<a:tbl>')
    expect(xml).toContain('Enero')
    expect(await chartTexts(buf)).toHaveLength(1)
  })

  it('una tabla de fechas conserva las celdas sin inventar una serie numérica', async () => {
    const buf = await renderPptx({
      slides: [
        {
          title: 'Calendario',
          table: {
            columns: ['Hito', 'Fecha'],
            rows: [
              ['Simulacro', '2026-06-03'],
              ['Entrega', '2026-06-15']
            ]
          }
        }
      ]
    })
    const [xml] = await slideTexts(buf)
    expect(xml).toContain('<a:tbl>')
    expect(xml).toContain('2026-06-03')
    expect(await chartTexts(buf)).toHaveLength(0)
  })

  it('dos viñetas breves crecen a 32 puntos y se distribuyen hasta la zona inferior', async () => {
    const buf = await renderPptx({
      slides: [{ title: 'Plan', layout: 'bullets', bullets: ['Revisar cobertura', 'Aprobar el siguiente paso'] }]
    })
    const [xml] = await slideTexts(buf)
    const points = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].filter(
      (m) => m[0].includes('Revisar cobertura') || m[0].includes('Aprobar el siguiente paso')
    )
    expect(points).toHaveLength(2)
    expect(points.every((m) => m[0].includes('sz="3200"'))).toBe(true)
    const secondY = Number(/<a:off x="\d+" y="(\d+)"/.exec(points[1][0])?.[1])
    expect(secondY / 914400).toBeGreaterThan(3)
  })
})

it('V23B: KPI mixtos son tarjetas editables y conservan variaciones y texto de apoyo sin inventar comparaciones', async () => {
  const buf = await renderPptx({
    slides: [
      {
        title: 'Cobertura',
        layout: 'kpis',
        bullets: ['Corte al cierre del semestre'],
        kpis: [
          { label: 'Oficinas', value: '18', delta: '+2' },
          { label: 'Familias', value: '240' }
        ]
      }
    ]
  })
  const [xml] = await slideTexts(buf)
  expect(xml).not.toContain('<a:tbl>')
  for (const text of ['Oficinas', '18', '+2', 'Familias', '240', 'Corte al cierre del semestre']) expect(xml).toContain(text)
  expect(await chartTexts(buf)).toHaveLength(0)
})

it('V23B corrección: dos importes de medidas y períodos distintos conservan tarjetas sin gráfico', async () => {
  const buf = await renderPptx({
    slides: [
      { title: 'Resultados', bullets: ['Ventas netas de febrero en Norte: $1.188.200', 'Devoluciones totales del trimestre: $116.525'] }
    ]
  })
  const [xml] = await slideTexts(buf)
  expect(xml).not.toContain('<a:tbl>')
  expect(xml).toContain('$1.188.200')
  expect(xml).toContain('Devoluciones totales del trimestre')
  expect(await chartTexts(buf)).toHaveLength(0)
})

it('V23B corrección: el respaldo apila montos largos en tarjetas con cifras mayores de 40 pt', async () => {
  const values = ['$90.000.000', '35 %', '$31.500.000']
  const buf = await renderPptx({
    slides: [{ title: 'Presupuesto', kpis: values.map((value, i) => ({ label: `Indicador ${i}`, value, delta: 'Nota del importe' })) }]
  })
  const [xml] = await slideTexts(buf)
  expect(xml).not.toContain('<a:tbl>')
  const shapes = [...xml.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((match) => match[0])
  const numbers = values.map((value) => shapes.find((shape) => shape.includes(`<a:t>${value}</a:t>`))!)
  expect(numbers.every(Boolean)).toBe(true)
  for (const number of numbers) expect(Number(/sz="(\d+)"/.exec(number)?.[1])).toBeGreaterThan(4000)
  expect(new Set(numbers.map((shape) => /<a:off x="\d+" y="(\d+)"/.exec(shape)?.[1])).size).toBe(3)
})
