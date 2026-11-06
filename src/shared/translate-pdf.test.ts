import { describe, expect, it } from 'vitest'
import {
  batchSegments,
  buildCardPrompt,
  buildCleanPagePrompt,
  cleanEligible,
  cleanName,
  fallbackPageHtml,
  sanitizeCleanHtml,
  wrapCleanHtml,
  buildTranslatePrompt,
  firstJsonObject,
  glossaryFor,
  parseCardAnswer,
  parseTranslateAnswer,
  translatedName,
  trimGlossary,
  type PdfSegment
} from './translate-pdf'

const seg = (id: string, texto: string, extra: Partial<PdfSegment> = {}): PdfSegment => ({ id, pagina: 1, texto, ...extra })

describe('batchSegments', () => {
  it('agrupa por orden de lectura respetando topes de textos y caracteres', () => {
    const segs = Array.from({ length: 10 }, (_, i) => seg(`p1-${i}`, 'x'.repeat(100)))
    const lotes = batchSegments(segs, 350, 40)
    expect(lotes.map((l) => l.length)).toEqual([3, 3, 3, 1])
    expect(lotes.flat().map((s) => s.id)).toEqual(segs.map((s) => s.id))
  })
  it('un texto más largo que el tope va solo y nunca se pierde', () => {
    const lotes = batchSegments([seg('a', 'x'.repeat(10)), seg('b', 'y'.repeat(9000)), seg('c', 'z')], 3500, 40)
    expect(lotes.map((l) => l.map((s) => s.id))).toEqual([['a'], ['b'], ['c']])
  })
  it('respeta el tope de textos por lote', () => {
    const segs = Array.from({ length: 5 }, (_, i) => seg(`p1-${i}`, 'a'))
    expect(batchSegments(segs, 3500, 2).map((l) => l.length)).toEqual([2, 2, 1])
  })
  it('sin textos no hay lotes', () => expect(batchSegments([])).toEqual([]))
})

describe('buildTranslatePrompt', () => {
  it('lleva el idioma, los textos con su id, las reglas y el glosario', () => {
    const p = buildTranslatePrompt({
      target: 'en',
      batch: [seg('p1-0', 'Hola <b>mundo</b>'), seg('p1-1', 'Excluye', { resaltado: ['Excluye'] })],
      glossary: { siniestro: 'loss' },
      docName: 'nota.pdf'
    })
    expect(p).toContain('into English')
    expect(p).toContain('"p1-0": "Hola <b>mundo</b>"')
    expect(p).toContain('siniestro → loss')
    expect(p).toContain('highlighted parts')
    expect(p).toContain('p1-1: "Excluye"') // se le dice QUÉ parte está resaltada, no solo el id
    expect(p).toContain('Do NOT translate code')
  })
  it('un texto resaltado entero no pide marcas [[ ]] (las pone la herramienta)', () => {
    const p = buildTranslatePrompt({
      target: 'en',
      batch: [seg('p5-1', 'Todo resaltado', { resaltado: 'todo' })],
      glossary: {},
      docName: 'a.pdf'
    })
    expect(p).not.toContain('highlighted parts')
  })
  it('para Word dice «Word document» y permite cursiva y subrayado', () => {
    const p = buildTranslatePrompt({ target: 'en', batch: [seg('d1-0', 'Hola')], glossary: {}, docName: 'a.docx', kind: 'docx' })
    expect(p).toContain('Word document "a.docx"')
    expect(p).toContain('<i>…</i> (italic)')
    expect(buildTranslatePrompt({ target: 'en', batch: [seg('p1-0', 'Hola')], glossary: {}, docName: 'a.pdf' })).not.toContain('italic')
  })
  it('sin resaltados ni glosario no nombra [[ ]] por id ni glosario', () => {
    const p = buildTranslatePrompt({ target: 'es', batch: [seg('p1-0', 'Hello')], glossary: {}, docName: 'a.pdf' })
    expect(p).not.toContain('highlighted parts')
    expect(p).not.toContain('glossary (source')
  })
})

describe('buildTranslatePrompt: frases cortadas por la hoja y contexto', () => {
  it('avisa de la continuación en otro lote y del texto anterior, solo como contexto', () => {
    const p = buildTranslatePrompt({
      target: 'en',
      batch: [seg('p1-9', 'la obra de la')],
      glossary: {},
      docName: 'a.pdf',
      before: 'Texto previo.',
      continuations: { 'p1-9': { id: 'p2-0', texto: 'ciudad se entregará pronto.' } }
    })
    expect(p).toContain('p1-9 continues in p2-0: "ciudad se entregará pronto."')
    expect(p).toContain('just before the first item is: "Texto previo."')
    expect(p).toContain('do NOT translate or return it')
  })
})

describe('firstJsonObject', () => {
  it('extrae el JSON aunque venga entre ``` o con texto alrededor', () => {
    expect(firstJsonObject('Claro:\n```json\n{"a": "x}y"}\n```\nlisto')).toBe('{"a": "x}y"}')
  })
  it('anidado y con comillas escapadas', () => {
    expect(firstJsonObject('{"a": {"b": "c\\"}"}}')).toBe('{"a": {"b": "c\\"}"}}')
  })
  it('sin objeto devuelve null', () => expect(firstJsonObject('nada')).toBeNull())
})

describe('parseTranslateAnswer', () => {
  const batch = [seg('p1-0', 'a'), seg('p1-1', 'b'), seg('p1-2', 'c')]
  it('lee traducciones y glosario, ignora ids ajenos y marca los que faltan', () => {
    const r = parseTranslateAnswer(
      '```json\n{"translations": {"p1-0": "A", "p1-1": "  ", "zzz": "x"}, "glossary": {"término": "term"}}\n```',
      batch
    )
    expect(r.translations).toEqual({ 'p1-0': 'A' })
    expect(r.missing).toEqual(['p1-1', 'p1-2'])
    expect(r.glossary).toEqual({ término: 'term' })
  })
  it('acepta un objeto plano {id: texto}', () => {
    const r = parseTranslateAnswer('{"p1-0": "A", "p1-1": "B", "p1-2": "C"}', batch)
    expect(r.missing).toEqual([])
  })
  it('lanza si no hay JSON', () => expect(() => parseTranslateAnswer('no puedo', batch)).toThrow())
  it('descarta glosario descomunal o con valores no texto', () => {
    const r = parseTranslateAnswer(`{"translations": {}, "glossary": {"${'x'.repeat(300)}": "y", "ok": 5, "bien": "well"}}`, batch)
    expect(r.glossary).toEqual({ bien: 'well' })
  })
})

describe('trimGlossary / translatedName', () => {
  it('conserva los términos más recientes', () => {
    const g = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`t${i}`, `u${i}`]))
    const t = trimGlossary(g, 60)
    expect(Object.keys(t)).toHaveLength(60)
    expect(t['t99']).toBe('u99')
    expect(t['t0']).toBeUndefined()
  })
  it('nombre del archivo traducido, sin separadores de ruta', () => {
    expect(translatedName('Informe final.PDF', 'en')).toBe('Informe final (en).pdf')
    expect(translatedName('../../etc/x.pdf', 'es')).toBe('.._.._etc_x (es).pdf')
    expect(translatedName('', 'fr')).toBe('documento (fr).pdf')
    expect(translatedName('Acta final.DOCX', 'en', 'docx')).toBe('Acta final (en).docx')
  })
})

describe('ficha del documento y glosario relevante', () => {
  it('parseCardAnswer lee la ficha aunque venga con texto alrededor, y devuelve null si no sirve', () => {
    const c = parseCardAnswer('Claro:\n```json\n{"summary":" Póliza de seguro. ","glossary":{"Insured":"Asegurado","":"x","ok":5}}\n```')
    expect(c).toEqual({ summary: 'Póliza de seguro.', glossary: { Insured: 'Asegurado' } })
    expect(parseCardAnswer('no hay json')).toBeNull()
    expect(parseCardAnswer('{"summary":"","glossary":{}}')).toBeNull()
  })

  it('buildCardPrompt incluye la muestra y pide solo JSON', () => {
    const p = buildCardPrompt({ target: 'es', docName: 'poliza.pdf', sample: '[page 1] hello' })
    expect(p).toContain('into Spanish')
    expect(p).toContain('poliza.pdf')
    expect(p.endsWith('[page 1] hello')).toBe(true)
  })

  it('glossaryFor deja los términos de la ficha y los que aparecen en el lote (sin mayúsculas), no los demás', () => {
    const g = { Deductible: 'Deducible', Arbitrator: 'Árbitro', Freight: 'Flete' }
    expect(glossaryFor('The deductible stated', g, { Insured: 'Asegurado' })).toEqual({ Insured: 'Asegurado', Deductible: 'Deducible' })
    expect(Object.keys(glossaryFor('x', g, {}, 0))).toEqual([])
  })

  it('el prompt con ficha y glosario relevante incluye el resumen, solo los términos del lote y la nota de la imagen', () => {
    const p = buildTranslatePrompt({
      target: 'es',
      batch: [seg('p1-0', 'The deductible applies.')],
      glossary: { Deductible: 'Deducible', Arbitrator: 'Árbitro' },
      docName: 'x.pdf',
      docCard: { summary: 'Insurance policy.', glossary: { Insured: 'Asegurado' } },
      relevantGlossary: true,
      pageImage: true
    })
    expect(p).toContain('About this document: Insurance policy.')
    expect(p).toContain('Deductible → Deducible')
    expect(p).toContain('Insured → Asegurado')
    expect(p).not.toContain('Arbitrator')
    expect(p).toContain('SCANNED page')
  })
})

describe('versión limpia (PDF nuevo)', () => {
  it('sanitizeCleanHtml deja solo etiquetas sencillas y quita scripts, estilos, enlaces, imágenes y atributos peligrosos', () => {
    const dirty =
      '```html\n<section class="page" onclick="x()"><script>alert(1)</script><style>p{}</style><h1 style="color:red">Título</h1>' +
      '<p class="foot">Pie <a href="http://evil.test">enlace</a><img src="http://evil.test/a.png"></p>' +
      '<table><tr><th colspan="2" onclick="y()">A</th></tr></table><iframe src="x"></iframe></section>\n```'
    const out = sanitizeCleanHtml(dirty)
    expect(out).toBe('<section class="page"><h1>Título</h1><p class="foot">Pie enlace</p><table><tr><th colspan="2">A</th></tr></table></section>')
    expect(out).not.toMatch(/script|onclick|style|href|<img|iframe/i)
    expect(sanitizeCleanHtml('<div class="cols3"><p class="otra">x</p></div>')).toBe('<div class="cols3"><p>x</p></div>')
  })

  it('wrapCleanHtml arma un documento A4 con el idioma y escapa el título; fallbackPageHtml escapa el texto', () => {
    const html = wrapCleanHtml(['<section class="page"><p>a</p></section>'], 'es', 'A <b> & B')
    expect(html).toContain('<html lang="es">')
    expect(html).toContain('@page { size: A4; margin: 18mm }')
    expect(html).toContain('<title>A &lt;b&gt; &amp; B</title>')
    expect(html).not.toContain('justify') // el texto justificado deja huecos enormes en columnas angostas
    expect(html).toContain('<section class="page"><p>a</p></section>')
    expect(fallbackPageHtml([{ texto: 'x < y & z' }])).toBe('<section class="page"><p>x &lt; y &amp; z</p></section>')
  })

  it('cleanName y cleanEligible', () => {
    expect(cleanName('poliza.pdf', 'es')).toBe('poliza (es, limpio).pdf')
    const segs = [seg('p1-0', 'a', { pagina: 1 }), seg('p2-0', 'b', { pagina: 2 })]
    expect(cleanEligible(segs, { 1: 'escaneada_ocr', 2: 'escaneada_ocr' })).toBe(true)
    expect(cleanEligible(segs, { 1: 'escaneada_ocr', 2: 'digital' })).toBe(false)
    expect(cleanEligible(segs, undefined)).toBe(false)
    expect(cleanEligible([], { 1: 'escaneada_ocr' })).toBe(false)
  })

  it('buildCleanPagePrompt incluye los textos traducidos, la imagen adjunta y pide una sola sección', () => {
    const p = buildCleanPagePrompt({
      target: 'es',
      page: 2,
      pages: 5,
      docName: 'x.pdf',
      paragraphs: [{ id: 'p2-0', texto: 'Hola' }],
      docCard: { summary: 'Póliza.', glossary: {} },
      pageImage: true
    })
    expect(p).toContain('page 2 of 5')
    expect(p).toContain('The attached image is the original page')
    expect(p).toContain('p2-0: Hola')
    expect(p).toContain('<section class="page">')
    expect(p).toContain('About this document: Póliza.')
  })
})
