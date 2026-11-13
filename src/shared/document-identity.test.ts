import { describe, expect, it } from 'vitest'
import { FREE_FONTS, isDocxSpec, isPptxSpec, type DocxSpec, type PptxSpec } from './chat-doc-spec'
import { identityContrast, resolveDocumentIdentity } from './document-identity'

const deck = (title: string): PptxSpec => ({ slides: [{ title }, { title: 'Resultados', bullets: ['Avance de 25 %'] }] })

describe('identidad documental aplicada', () => {
  it('es determinista, no muta entrada y conserva identidad al corregir cifras/cuerpo', () => {
    const spec = deck('Conservación marina 2026')
    const before = structuredClone(spec)
    const identity = resolveDocumentIdentity(spec)
    expect(resolveDocumentIdentity(spec)).toEqual(identity)
    expect(spec).toEqual(before)
    const correction = deck('Conservación marina 2027')
    correction.slides[1].bullets = ['Avance corregido de 45 %']
    expect(resolveDocumentIdentity(correction)).toEqual({ ...identity, concept: 'Conservación marina 2027' })
  })
  it('separa temas por paleta, fuentes y composición; permite conservar una marca entre temas', () => {
    const names = ['Museo marino', 'Comité financiero', 'Cafetería de barrio', 'Campaña cultural']
    const ids = names.map((n) => resolveDocumentIdentity(deck(n)))
    expect(new Set(ids.map((d) => d.palette.accent)).size).toBe(4)
    expect(new Set(ids.map((d) => d.fonts.title)).size).toBeGreaterThan(1)
    expect(new Set(ids.map((d) => d.cover + d.background + d.cards)).size).toBeGreaterThan(1)
    const brand = { concept: 'Marca entregada de la institución', palette: { bg: '#FFFFFF', text: '#222222', accent: '#703020' } }
    expect(resolveDocumentIdentity({ ...deck(names[0]), identity: brand })).toEqual(
      resolveDocumentIdentity({ ...deck(names[1]), identity: brand })
    )
  })
  it('un título genérico usa el contenido y su tono, con cifras normalizadas', () => {
    const museum: DocxSpec = {
      title: 'Informe',
      blocks: [
        { type: 'heading', level: 1, text: 'Conservación marina' },
        { type: 'paragraph', text: 'Observamos 28 especies.' }
      ]
    }
    const finance: DocxSpec = { title: 'Informe', blocks: [{ type: 'heading', level: 1, text: 'Comité financiero' }] }
    expect(resolveDocumentIdentity(museum).palette).not.toEqual(resolveDocumentIdentity(finance).palette)
    expect(resolveDocumentIdentity(museum)).toEqual(
      resolveDocumentIdentity({ ...museum, blocks: [museum.blocks[0], { type: 'paragraph', text: 'Observamos 40 especies.' }] })
    )
  })
  it('todas las tintas derivadas cumplen AA sobre fondo y tarjetas', () => {
    for (let i = 0; i < 90; i++) {
      const d = resolveDocumentIdentity(deck(`Tema ${String.fromCharCode(65 + i)} documental`))
      for (const ink of ['text', 'accent', 'accent2', 'muted'] as const) {
        expect(identityContrast(d.palette[ink], d.palette.bg)).toBeGreaterThanOrEqual(4.5)
        expect(identityContrast(d.palette[ink], d.palette.panel)).toBeGreaterThanOrEqual(4.5)
      }
      expect(FREE_FONTS).toContain(d.fonts.title)
      expect(FREE_FONTS).toContain(d.fonts.body)
    }
  })
  it('corrige paletas ilegibles sin sustituir el fondo ni perder un acento legible', () => {
    const d = resolveDocumentIdentity({
      ...deck('Propia'),
      identity: { palette: { bg: '#FFFFFF', text: '#EEEEEE', accent: '#FFFF99', panel: '#000000' } }
    })
    expect(d.palette.bg).toBe('#FFFFFF')
    for (const c of [d.palette.text, d.palette.accent, d.palette.muted])
      expect(identityContrast(c, d.palette.bg)).toBeGreaterThanOrEqual(4.5)
    const explicit = { bg: '#FFFFFF', text: '#222222', accent: '#703020' }
    expect(resolveDocumentIdentity({ ...deck('Propia'), palette: explicit }).palette.accent).toBe('#703020')
  })
  it('conserva opciones legacy y da prioridad a identidad explícita', () => {
    const spec: PptxSpec = { ...deck('Prueba'), theme: 'warm', fonts: { title: 'Georgia', body: 'Tahoma' } }
    expect(resolveDocumentIdentity(spec).palette.bg).toBe('#FFF8F0')
    expect(resolveDocumentIdentity(spec).fonts).toEqual(spec.fonts)
    expect(resolveDocumentIdentity({ ...spec, identity: { fonts: { title: 'Verdana' } } }).fonts).toEqual({
      title: 'Verdana',
      body: 'Tahoma'
    })
  })
  it('acepta el mismo bloque visual en Word y presentaciones', () => {
    const identity = {
      concept: 'Editorial marina',
      fonts: { title: 'Georgia' as const, body: 'Arial' as const },
      cover: 'band' as const,
      headers: 'accent' as const
    }
    const doc: DocxSpec = { title: 'Informe', identity, blocks: [{ type: 'paragraph', text: 'Texto' }] }
    expect(isDocxSpec(doc)).toBe(true)
    expect(isPptxSpec({ ...deck('Informe'), identity })).toBe(true)
    expect(resolveDocumentIdentity(doc)).toEqual(resolveDocumentIdentity({ ...deck('Informe'), identity }))
  })
  it.each([
    { concept: '' },
    { concept: 'a'.repeat(501) },
    { titles: 'unknown' },
    { cards: 'circle' },
    { cover: 'image' },
    { headers: 'huge' },
    { photos: 'stretch' },
    { fonts: { title: 'Missing font' } },
    { fonts: { body: 'Arial', size: 4 } },
    { palette: { bg: '#FFF', text: '#222222', accent: '#123456' } },
    { command: 'file.delete' },
    []
  ])('rechaza identidad fuera de esquema: %j', (identity) => {
    expect(isPptxSpec({ ...deck('Informe'), identity })).toBe(false)
    expect(isDocxSpec({ blocks: [{ type: 'paragraph', text: 'Texto' }], identity })).toBe(false)
  })
})
