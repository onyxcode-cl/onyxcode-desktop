import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import type { DocumentIdentity, PptxSlideSpec, PptxSpec } from '@shared/chat-doc-spec'
import { resolveDocumentIdentity } from '@shared/document-identity'
import { chatDeckCommands } from './chat-deck'
import { renderPptx } from '../../extras/render-pptx'
import type { ImageMap } from '../../documents/image-files'
import { autoFitSize, contrastRatio, DeckTextFitError } from './deck-kit'

const identity: DocumentIdentity = {
  concept: 'Museo marino documental',
  palette: { bg: '#FAFAF7', text: '#172B28', accent: '#176253', panel: '#F0F3ED' },
  fonts: { title: 'Georgia', body: 'Verdana' },
  titles: 'plain',
  cards: 'rounded',
  background: 'plain',
  rhythm: 'balanced',
  photos: 'contain',
  cover: 'left'
}
const images: ImageMap = new Map([
  ['photo.png', { file: '/synthetic/photo.png', width: 1200, height: 800, kind: 'png', mime: 'image/png', ext: 'png', bytes: 10 }]
])
const parse = (commands: string[]) =>
  commands.map((c) => ({ id: c.split('=')[0], p: c.includes('=') ? JSON.parse(c.slice(c.indexOf('=') + 1)) : {} }))
const geometry = (commands: string[]) =>
  parse(commands)
    .filter((c) => c.p.rect)
    .map((c) => [c.id, c.p.rect])

describe('V26 identidad aplicada PPTX', () => {
  it('la identidad llega a fuentes, paleta, títulos y tarjetas; no aparece la línea universal', () => {
    const spec: PptxSpec = {
      identity,
      slides: [
        {
          layout: 'two-col',
          title: 'Colecciones',
          columns: [
            { heading: 'Costa', bullets: ['Bosques de algas'] },
            { heading: 'Océano', bullets: ['Fauna pelágica'] }
          ]
        }
      ]
    }
    const commands = chatDeckCommands(spec)
    expect(commands).toContain('design.fonts={"major":"Georgia","minor":"Verdana"}')
    expect(commands).toContain('format.font={"family":"Verdana"}')
    expect(commands).toContain('design.background={"color":"#FAFAF7"}')
    expect(commands).toContain('format.bold={"on":false}')
    expect(parse(commands).some((c) => c.id === 'shape.insert' && c.p.preset === 'roundRect')).toBe(true)
    expect(parse(commands).some((c) => JSON.stringify(c.p.rect) === '[60,128,840,4]')).toBe(false)
  })

  const slides: PptxSlideSpec[] = [
    { layout: 'cover', title: 'Museo marino', bullets: ['Conservar y aprender'] },
    { layout: 'stat', title: '84 %', bullets: ['Cobertura', 'Evidencia validada'] },
    {
      layout: 'kpis',
      title: 'Indicadores',
      kpis: [
        { label: 'Sitios', value: '12', delta: '+3' },
        { label: 'Especies', value: '48', delta: '+8' }
      ]
    },
    {
      layout: 'two-col',
      title: 'Comparación',
      columns: [
        { heading: 'Costa', bullets: ['Medición local'] },
        { heading: 'Océano', bullets: ['Medición abierta'] }
      ]
    },
    { layout: 'closing', title: 'Próximos pasos', bullets: ['Medir', 'Conservar'] },
    {
      layout: 'image',
      title: 'Hábitats',
      image: { path: 'photo.png', alt: 'Imagen sintética' },
      bullets: ['Biodiversidad costera', 'Protección del hábitat']
    }
  ]
  it.each(slides)('tres geometrías reales para $layout, dentro del lienzo y con texto conservado', (slide) => {
    const variants = ['calm', 'balanced', 'dynamic'].map((rhythm, i) => {
      const spec: PptxSpec = {
        identity: { ...identity, rhythm: rhythm as DocumentIdentity['rhythm'], cover: (['left', 'center', 'band'] as const)[i] },
        slides: [slide]
      }
      const commands = chatDeckCommands(spec, images)
      for (const { p } of parse(commands).filter((c) => c.p.rect)) {
        const [x, y, w, h] = p.rect
        expect(x).toBeGreaterThanOrEqual(0)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(x + w).toBeLessThanOrEqual(960.01)
        expect(y + h).toBeLessThanOrEqual(540.01)
      }
      for (const text of [slide.title, ...(slide.bullets ?? [])]) expect(commands.join('\n')).toContain(text)
      expect(chatDeckCommands(spec, images)).toEqual(commands)
      return JSON.stringify(geometry(commands))
    })
    expect(new Set(variants).size).toBe(3)
  })

  it('no parte Encuentro por ancho de la banda y mezcla el tema por tipo de composición', () => {
    expect(autoFitSize('Encuentro cultural', 66, 300, 338, false)).toBeLessThanOrEqual(56)
    const sequences = ['Conservación marina', 'Comité financiero', 'Cafetería de barrio', 'Campaña cultural'].map((title) => {
      const spec: PptxSpec = { slides: [{ title, layout: 'cover' }, ...slides.slice(1, 5)] }
      return JSON.stringify(geometry(chatDeckCommands(spec)))
    })
    expect(new Set(sequences).size).toBe(4)
  })

  it('la composición y la identidad sobreviven una corrección de cifras', () => {
    const before: PptxSpec = {
      slides: [
        { title: 'Conservación marina', layout: 'cover' },
        {
          title: 'Indicadores',
          layout: 'kpis',
          kpis: [
            { label: 'Cobertura', value: '84 %' },
            { label: 'Sitios', value: '12' }
          ]
        }
      ]
    }
    const after = JSON.parse(JSON.stringify(before)) as PptxSpec
    after.slides[1].kpis![0].value = '89 %'
    expect(resolveDocumentIdentity(after)).toEqual(resolveDocumentIdentity(before))
    expect(geometry(chatDeckCommands(after))).toEqual(geometry(chatDeckCommands(before)))
    const pal = resolveDocumentIdentity(before).palette
    for (const fg of [pal.text, pal.accent, pal.muted!])
      for (const bg of [pal.bg, pal.panel!]) expect(contrastRatio(fg.slice(1), bg.slice(1))).toBeGreaterThanOrEqual(4.5)
  })

  it('cuatro KPI con variaciones y columnas extensas mantienen mínimos; contenido imposible se rechaza', () => {
    const stress: PptxSpec = {
      identity: { ...identity, palette: { bg: '#101B24', text: '#F4F4EF', accent: '#93D0BC', panel: '#182832' } },
      slides: [
        {
          layout: 'kpis',
          title: 'Seguimiento',
          kpis: ['Cobertura regional', 'Sitios protegidos', 'Visitas de terreno', 'Avance trimestral'].map((label, i) => ({
            label,
            value: `${84 + i} %`,
            delta: '+8 % anual'
          }))
        },
        {
          layout: 'two-col',
          title: 'Método',
          columns: [
            {
              heading: 'Campo',
              bullets: ['Observación documentada en terreno con control de calidad', 'Registro comparable de condiciones ambientales']
            },
            {
              heading: 'Laboratorio',
              bullets: ['Evaluación de muestras y trazabilidad de resultados', 'Publicación revisada por el equipo científico']
            }
          ]
        }
      ]
    }
    const commands = parse(chatDeckCommands(stress))
    for (let i = 0; i < commands.length; i++)
      if (commands[i].id === 'insert.textBox' && !/^0[12]$/.test(commands[i].p.text))
        expect(commands[i + 1].p.size).toBeGreaterThanOrEqual(14)
    const pal = resolveDocumentIdentity(stress).palette
    for (const fg of [pal.text, pal.accent, pal.muted!])
      for (const bg of [pal.bg, pal.panel!]) expect(contrastRatio(fg.slice(1), bg.slice(1))).toBeGreaterThanOrEqual(4.5)
    expect(() =>
      chatDeckCommands({
        identity,
        slides: [{ layout: 'two-col', title: 'Exceso', columns: [{ bullets: ['ininterrumpido'.repeat(30)] }, { bullets: ['Legible'] }] }]
      })
    ).toThrow(DeckTextFitError)
  })

  it('una tabla imposible exige repartir el contenido antes de bajar de 14 pt', () => {
    expect(() =>
      chatDeckCommands({
        identity,
        slides: [
          {
            title: 'Registro',
            layout: 'table',
            table: {
              columns: ['Descripción', 'Detalle'],
              rows: Array.from({ length: 8 }, () => [
                'Condiciones de conservación y análisis de muestras '.repeat(6),
                'Resultado documentado'
              ])
            }
          }
        ]
      })
    ).toThrow(DeckTextFitError)
  })

  it('respeta tinta explícita del lienzo libre sobre formas y no pierde la etiqueta con foto panorámica', () => {
    const free: PptxSpec = {
      identity: { ...identity, palette: { bg: '#FFFFFF', text: '#111111', accent: '#176253' } },
      slides: [
        {
          layout: 'free',
          elements: [
            { type: 'shape', shape: 'rect', x: 60, y: 80, w: 840, h: 300, fill: '#111111' },
            { type: 'text', x: 100, y: 150, w: 760, h: 100, text: 'Texto sobre panel negro', color: '#FFFFFF', size: 32 }
          ]
        }
      ]
    }
    const commands = parse(chatDeckCommands(free))
    const at = commands.findIndex((c) => c.id === 'insert.textBox' && c.p.text === 'Texto sobre panel negro')
    expect(commands[at + 2].p.color).toBe('#FFFFFF')
    const wide = chatDeckCommands(
      {
        identity: { ...identity, photos: 'wide' },
        slides: [
          {
            layout: 'cover',
            title: 'Museo marino',
            eyebrow: 'Colección documental',
            image: { path: 'photo.png' },
            bullets: ['Conservar y aprender']
          }
        ]
      },
      images
    )
    expect(wide.join('\n')).toContain('Colección documental')
  })

  it('cuatro indicadores con variación y comentario no fallan por la variante elegida automáticamente', () => {
    for (const rhythm of ['calm', 'balanced', 'dynamic'] as const) {
      const spec: PptxSpec = {
        identity: { concept: 'Museo marino', rhythm },
        slides: [
          {
            layout: 'kpis',
            title: 'Indicadores',
            kpis: [
              { label: 'A', value: '12', delta: '+1' },
              { label: 'B', value: '24', delta: '+2' },
              { label: 'C', value: '48', delta: '+4' },
              { label: 'D', value: '96', delta: '+8' }
            ],
            bullets: ['Resultado medido.']
          }
        ]
      }
      const commands = parse(chatDeckCommands(spec))
      for (const text of ['+1', '+2', '+4', '+8', 'Resultado medido.']) {
        const at = commands.findIndex((c) => c.id === 'insert.textBox' && c.p.text === text)
        expect(at).toBeGreaterThan(0)
        expect(commands[at + 1].p.size).toBeGreaterThanOrEqual(14)
      }
    }
  })

  it('calcula contraste sobre la tarjeta aunque la lámina cambie a un fondo opuesto', () => {
    const own: DocumentIdentity = {
      ...identity,
      cards: 'rounded',
      palette: { bg: '#101B24', text: '#F4F4EF', accent: '#93D0BC', panel: '#182832' }
    }
    const spec: PptxSpec = {
      identity: own,
      slides: [
        {
          title: 'Indicadores',
          background: '#FFFFFF',
          layout: 'kpis',
          kpis: [
            { label: 'Cobertura', value: '84 %' },
            { label: 'Sitios', value: '12' }
          ]
        }
      ]
    }
    const commands = parse(chatDeckCommands(spec))
    for (const text of ['Cobertura', '84 %', 'Sitios', '12']) {
      const at = commands.findIndex((c) => c.id === 'insert.textBox' && c.p.text === text)
      expect(
        contrastRatio(commands[at + 2].p.color.slice(1), resolveDocumentIdentity(spec).palette.panel!.slice(1))
      ).toBeGreaterThanOrEqual(4.5)
    }
    const title = commands.findIndex((c) => c.id === 'insert.textBox' && c.p.text === 'Indicadores')
    expect(contrastRatio(commands[title + 2].p.color.slice(1), 'FFFFFF')).toBeGreaterThanOrEqual(4.5)
  })

  it('el archivo real de respaldo conserva paleta y par de fuentes propios incluso para free', async () => {
    const spec: PptxSpec = {
      identity,
      slides: [
        {
          layout: 'free',
          elements: [
            { type: 'text', x: 60, y: 60, w: 500, h: 100, text: 'Museo marino', size: 60 },
            { type: 'text', x: 60, y: 200, w: 500, h: 100, text: 'Patrimonio compartido', size: 24 }
          ],
          speaker_notes: 'Conservar esta nota'
        },
        { title: 'Colección', bullets: ['Conservación y comunidad'] }
      ]
    }
    const zip = await JSZip.loadAsync(await renderPptx(spec))
    const theme = await zip.file('ppt/theme/theme1.xml')!.async('string')
    const body = await zip.file('ppt/slides/slide2.xml')!.async('string')
    expect(theme).toContain('typeface="Georgia"')
    expect(theme).toContain('typeface="Verdana"')
    expect(body).toContain('FAFAF7')
    expect(body).toContain('172B28')
    expect(body).toContain('typeface="+mn-lt"')
    expect(await zip.file('ppt/notesSlides/notesSlide1.xml')!.async('string')).toContain('Conservar esta nota')
  })
})
