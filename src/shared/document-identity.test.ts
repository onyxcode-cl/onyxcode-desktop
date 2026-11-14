import { describe, expect, it } from 'vitest'
import { FREE_FONTS, isDocxSpec, isPptxSpec, type DocxSpec, type PptxSpec } from './chat-doc-spec'
import { identityContrast, resolveDocumentIdentity } from './document-identity'

const deck = (title: string): PptxSpec => ({ slides: [{ title }, { title: 'Resultados', bullets: ['Avance de 25 %'] }] })
// Subtítulo adicional que llega de specs legacy del modelo; no amplía el contrato actual.
const legacyCover = (title: string, subtitle: string): PptxSpec['slides'][number] & { subtitle: string } => ({ title, subtitle })

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
  it('usa el tema nombrado como inspiración y da prioridad a fuentes explícitas', () => {
    const spec: PptxSpec = { ...deck('Prueba'), theme: 'warm', fonts: { title: 'Georgia', body: 'Tahoma' } }
    expect(resolveDocumentIdentity(spec).palette).not.toEqual(resolveDocumentIdentity(deck('Prueba')).palette)
    expect(resolveDocumentIdentity(spec).fonts).toEqual(spec.fonts)
    expect(resolveDocumentIdentity({ ...spec, identity: { fonts: { title: 'Verdana' } } }).fonts).toEqual({
      title: 'Verdana',
      body: 'Tahoma'
    })
  })
  it.each([
    ['warm', 'Energía solar para la minería', 'Pastelería francesa de otoño'],
    ['green', 'Dinosaurios para niños', 'Clínica dental']
  ] as const)('dos temas %s se separan en color, tipografía y tono, sin aleatoriedad', (theme, first, second) => {
    const specs = [first, second].map((title) => ({ ...deck(title), theme }))
    const [a, b] = specs.map(resolveDocumentIdentity)
    expect(a.palette.bg).not.toBe(b.palette.bg)
    expect(a.palette.accent).not.toBe(b.palette.accent)
    expect(a.fonts).not.toEqual(b.fonts)
    expect(a.tone).not.toBe(b.tone)
    expect(a.cards + a.rhythm + a.background).not.toBe(b.cards + b.rhythm + b.background)
    specs.forEach((spec, index) => expect(resolveDocumentIdentity(structuredClone(spec))).toEqual([a, b][index]))
  })
  it('extrae el tema de subtítulos y texto libre sin depender de geometría ni cifras', () => {
    const dental: PptxSpec = {
      theme: 'green',
      slides: [legacyCover('Informe trimestral', 'Clínica dental · Tercer trimestre 2026')]
    }
    const mine: PptxSpec = {
      ...dental,
      slides: [legacyCover('Informe trimestral', 'Operación minera · Tercer trimestre 2026')]
    }
    expect(resolveDocumentIdentity(dental).tone).toBe('institutional')
    expect(resolveDocumentIdentity(dental).seed).not.toBe(resolveDocumentIdentity(mine).seed)
    expect(resolveDocumentIdentity(dental)).toEqual(
      resolveDocumentIdentity({ ...dental, slides: [legacyCover('Informe trimestral', 'Clínica dental · Tercer trimestre 2027')] })
    )
    const pastry: PptxSpec = {
      theme: 'warm',
      slides: [
        {
          layout: 'free',
          elements: [
            { type: 'text', text: 'MENÚ DE OTOÑO', size: 16, x: 60, y: 150, w: 560, h: 60 },
            { type: 'text', text: 'Sabores de otoño', size: 48, x: 60, y: 200, w: 560, h: 150 },
            { type: 'text', text: 'Castañas y especias en nuestra pastelería', size: 18, x: 60, y: 360, w: 520, h: 60 }
          ]
        }
      ]
    }
    const before = structuredClone(pastry)
    expect(resolveDocumentIdentity(pastry)).toMatchObject({ concept: 'Sabores de otoño', tone: 'luxury' })
    expect(pastry).toEqual(before)
    const moved = structuredClone(pastry)
    moved.slides[0].elements![0].x = 80
    expect(resolveDocumentIdentity(moved)).toEqual(resolveDocumentIdentity(pastry))
  })
  it.each([
    ['Dinosaurios para niños', 'playful', ['Comic Sans MS', 'Trebuchet MS']],
    ['Pastelería francesa de lujo', 'luxury', ['Georgia', 'Times New Roman']],
    ['Manual técnico', 'technical', ['Courier New', 'Arial Black']],
    ['Gira de rock', 'rock', ['Impact', 'Arial Black']],
    ['Informe institucional', 'institutional', ['Tahoma', 'Verdana']]
  ] as const)('elige una familia de fuentes según el tono de %s', (title, tone, headings) => {
    const identity = resolveDocumentIdentity(deck(title))
    expect(identity.tone).toBe(tone)
    expect(headings).toContain(identity.fonts.title)
    const word: DocxSpec = { title, blocks: [{ type: 'paragraph', text: 'Contenido de prueba.' }] }
    expect(resolveDocumentIdentity(word).fonts).toEqual(identity.fonts)
  })
  it('admite fuentes comunes ampliadas y conserva paleta explícita aunque cambie el tema nombrado', () => {
    const palette = { bg: '#FFF8F0', text: '#302820', accent: '#762A47' }
    for (const title of ['Comic Sans MS', 'Impact', 'Arial Black'] as const) {
      const identity = { fonts: { title, body: 'Verdana' as const }, palette }
      expect(isPptxSpec({ ...deck('Prueba'), identity })).toBe(true)
      expect(isDocxSpec({ title: 'Prueba', blocks: [{ type: 'paragraph', text: 'Texto' }], identity })).toBe(true)
      expect(resolveDocumentIdentity({ ...deck('Solar'), theme: 'warm', identity }).palette.accent).toBe('#762A47')
      expect(resolveDocumentIdentity({ ...deck('Solar'), theme: 'green', identity }).palette.bg).toBe('#FFF8F0')
    }
  })
  it('reserva metal, tour y gira para rock solo cuando hay contexto musical', () => {
    const themed = (title: string, body: string): PptxSpec => ({
      theme: 'green',
      slides: [{ title }, { title: 'Detalles', bullets: [body] }]
    })
    expect(resolveDocumentIdentity(themed('Operación minera', 'Producción de metal y seguridad laboral')).tone).toBe('technical')
    expect(resolveDocumentIdentity(themed('Tour por la Patagonia', 'Turismo de naturaleza')).tone).toBe('editorial')
    expect(resolveDocumentIdentity(themed('Gira de estudio', 'Turismo y patrimonio cultural')).tone).toBe('editorial')
    expect(resolveDocumentIdentity(themed('Metal industrial', 'Banda transportadora para la operación minera')).tone).toBe('technical')
    expect(
      resolveDocumentIdentity({
        slides: [
          legacyCover('Ruta Nocturna 2027', 'Gira latinoamericana de Los Relámpagos del Sur'),
          { title: 'Qué incluye la gira', bullets: ['Setlist: 22 canciones y 3 estrenos', 'Telonero: Banda Fantasma'] }
        ]
      }).tone
    ).toBe('rock')
  })
  it('todos los temas nombrados conservan AA sobre fondo y tarjetas en cada tono', () => {
    for (const theme of ['warm', 'green', 'blue', 'mono', 'dark'] as const) {
      for (const title of ['Dinosaurios', 'Pastelería francesa', 'Manual técnico', 'Gira rock', 'Clínica dental']) {
        const { palette } = resolveDocumentIdentity({ ...deck(title), theme })
        for (const ink of ['text', 'accent', 'accent2', 'muted'] as const) {
          expect(identityContrast(palette[ink], palette.bg)).toBeGreaterThanOrEqual(4.5)
          expect(identityContrast(palette[ink], palette.panel)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
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
