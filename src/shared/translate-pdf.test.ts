import { describe, expect, it } from 'vitest'
import {
  batchSegments,
  buildTranslatePrompt,
  firstJsonObject,
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
