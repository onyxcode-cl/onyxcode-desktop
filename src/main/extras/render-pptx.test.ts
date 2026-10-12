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

  it('fondo a toda página: portada y cierre usan "primary", sección y cifra "primary2" — el contenido (viñetas) se queda en blanco, por legibilidad', async () => {
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
    const primaryBg = bgPattern(THEMES.blue.primary)
    const primary2Bg = bgPattern(THEMES.blue.primary2)
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
    expect(text).toContain(THEMES.blue.primary2) // "section" usa primary2, aunque sea la diapositiva 0 (que por índice sería portada)
  })

  it('el theme cambia la paleta de todo el deck', async () => {
    const spec: PptxSpec = { theme: 'green', slides: [{ title: 'Portada' }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect(text).toContain(THEMES.green.primary)
    expect(text).not.toContain(THEMES.blue.primary)
  })

  it('numera las páginas en las diapositivas de contenido ("2 / 3", etc.)', async () => {
    const spec: PptxSpec = {
      slides: [{ title: 'Portada' }, { title: 'A', bullets: ['x'] }, { title: 'B', bullets: ['y'] }]
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

  it('cada diapositiva de fondo a toda página trae su propio círculo de textura', async () => {
    const spec: PptxSpec = {
      slides: [{ title: 'Portada' }, { title: 'Sección' }, { title: 'A', bullets: ['x'] }, { title: '80%', bullets: ['y'], layout: 'stat' }]
    }
    const buf = await renderPptx(spec)
    const texts = await slideTexts(buf)
    expect((texts[0].match(/prst="ellipse"/g) ?? []).length).toBeGreaterThan(0) // portada
    expect((texts[1].match(/prst="ellipse"/g) ?? []).length).toBeGreaterThan(0) // sección
    expect((texts[3].match(/prst="ellipse"/g) ?? []).length).toBeGreaterThan(0) // cifra
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
    expect(text).toContain(THEMES.blue.primary2) // panel derecho invertido
  })

  it('layout "cards": cada viñeta sale como una tarjeta numerada (roundRect + círculo con el número + su propio texto)', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Ventajas', bullets: ['Rápido', 'Seguro', 'Simple'], layout: 'cards' }] }
    const buf = await renderPptx(spec)
    const [text] = await slideTexts(buf)
    expect((text.match(/prst="roundRect"/g) ?? []).length).toBe(3)
    expect((text.match(/prst="ellipse"/g) ?? []).length).toBe(3)
    for (const b of ['Rápido', 'Seguro', 'Simple']) expect(text).toContain(b)
  })

  it('layout "kpis": de 2 a 4 métricas en fila (una tarjeta roundRect por métrica, con su etiqueta/número/variación) — DISTINTO de "cards" (sin círculo numerado) y de "stat" (acá son varias, no una sola como foco)', async () => {
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
    expect((text.match(/prst="roundRect"/g) ?? []).length).toBe(3) // una tarjeta por KPI
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
    expect(chart).toContain(THEMES.blue.chart[0])
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

  it('el tema elige la tipografía del título: Georgia en los temas editoriales (blue/green/warm), Arial en negrita en los más "corporativos" (dark/mono) — el cuerpo siempre en Arial', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Título', bullets: ['cuerpo'] }] }
    const warm = await slideTexts(await renderPptx({ theme: 'warm', ...spec }))
    const dark = await slideTexts(await renderPptx({ theme: 'dark', ...spec }))
    expect(warm[0]).toContain('typeface="Georgia"')
    expect(dark[0]).not.toContain('typeface="Georgia"')
  })

  it('sin "style": el look es idéntico al de siempre (equivale a "classic") — cero regresión para decks ya generados', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Portada' }, { title: 'X', bullets: ['a'], layout: 'cards' }] }
    const [plain, classic] = await Promise.all([
      slideTexts(await renderPptx(spec)),
      slideTexts(await renderPptx({ ...spec, style: 'classic' }))
    ])
    expect(plain).toEqual(classic)
  })

  it('"style": cambia la decoración de las diapositivas a toda página (círculo en "classic", barra rotada en "geometric", línea fina de borde a borde en "editorial", nada en "minimal")', async () => {
    const spec: PptxSpec = { slides: [{ title: 'Portada' }] }
    const classic = (await slideTexts(await renderPptx({ ...spec, style: 'classic' })))[0]
    const geometric = (await slideTexts(await renderPptx({ ...spec, style: 'geometric' })))[0]
    const editorial = (await slideTexts(await renderPptx({ ...spec, style: 'editorial' })))[0]
    const minimal = (await slideTexts(await renderPptx({ ...spec, style: 'minimal' })))[0]
    expect(classic).toContain('prst="ellipse"') // círculo sutil de siempre
    expect(geometric).not.toContain('prst="ellipse"')
    expect(geometric).toContain('rot="2700000"') // barra rotada 45°
    expect(editorial).not.toContain('prst="ellipse"')
    expect(editorial).not.toContain('rot=')
    expect(editorial).toContain('name="Shape 0"') // la línea fina sí es una forma de verdad
    expect(minimal).not.toContain('prst="ellipse"')
    expect(minimal).not.toContain('name="Shape 0"') // "minimal" no agrega ninguna forma decorativa
  })

  it('"style": cambia la forma de las tarjetas (radio de esquina, relleno y borde) en "cards"/"kpis" — nunca la posición/tamaño', async () => {
    const cards: PptxSpec = { slides: [{ title: 'X', layout: 'cards', bullets: ['a', 'b'] }] }
    const classic = (await slideTexts(await renderPptx({ ...cards, style: 'classic' })))[0]
    const geometric = (await slideTexts(await renderPptx({ ...cards, style: 'geometric' })))[0]
    const editorial = (await slideTexts(await renderPptx({ ...cards, style: 'editorial' })))[0]
    const minimal = (await slideTexts(await renderPptx({ ...cards, style: 'minimal' })))[0]
    expect(classic).toContain('fmla="val 4706"') // rectRadius 0.08
    expect(geometric).toContain('fmla="val 11765"') // rectRadius 0.2, más redondeada ("pill")
    // rectRadius 0 NUNCA se manda como "roundRect" con radio 0 — bug real de pptxgenjs (chequea el
    // valor con `if (rectRadius)`, así que 0 nunca escribe el "adj" y PowerPoint cae al radio PROPIO
    // del preset "roundRect", bien redondeado, no la esquina recta que pide el estilo) — por eso acá
    // la tarjeta usa la forma "rect" lisa en vez de "roundRect" sin radio.
    expect(classic).toContain('prst="roundRect"')
    expect(geometric).toContain('prst="roundRect"')
    expect(editorial).not.toContain('prst="roundRect"')
    expect(minimal).not.toContain('prst="roundRect"')
    expect(editorial).not.toContain('fmla="val') // rectRadius 0, esquina recta
    expect(classic).toContain(THEMES.blue.surface) // "classic" rellena la tarjeta
    expect(editorial).not.toContain(THEMES.blue.surface) // "editorial" NO rellena — bloque de texto plano
    expect(geometric).toContain(THEMES.blue.surface) // "geometric" sí rellena
    expect(geometric).not.toContain(THEMES.blue.border) // "geometric" sin borde
    expect(minimal).toContain(THEMES.blue.border) // "minimal" sí lleva borde fino (y nunca relleno)
    expect(minimal).not.toContain(THEMES.blue.surface)
    expect(editorial).not.toContain('prst="ellipse"') // "editorial" no usa círculo numerado
    expect(geometric).toContain('prst="ellipse"') // "geometric" sigue usando círculo numerado
  })

  it('"style" por defecto es "classic" aunque no se declare explícito ("classic" === sin campo)', async () => {
    const spec: PptxSpec = { style: 'classic', slides: [{ title: 'Portada' }] }
    const [text] = await slideTexts(await renderPptx(spec))
    expect((text.match(/prst="ellipse"/g) ?? []).length).toBeGreaterThan(0)
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
