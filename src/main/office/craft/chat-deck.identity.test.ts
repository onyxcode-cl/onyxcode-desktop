import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { DocumentIdentity, PptxSlideSpec, PptxSpec } from '@shared/chat-doc-spec'
import { resolveDocumentIdentity } from '@shared/document-identity'
import { chatDeckCommands, clearBleedDecorations, renderChatDeck } from './chat-deck'
import { renderPreview } from '../../documents/preview'
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

  it.each(['cover', 'closing', 'image'] as const)(
    '%s: conserva la identidad y reserva el pie de crédito en todas las variantes',
    (layout) => {
      const attribution = 'Foto: Autor · CC BY-SA 4.0 · Wikimedia Commons'
      const credit = 'Figura 1. Hábitat costero documentado. '.repeat(6).slice(0, 240 - attribution.length) + attribution
      const portrait: ImageMap = new Map([['photo.png', { ...images.get('photo.png')!, width: 800, height: 1200 }]])
      const intersects = (a: number[], b: number[]): boolean =>
        a[0] < b[0] + b[2] && a[0] + a[2] > b[0] && a[1] < b[1] + b[3] && a[1] + a[3] > b[1]
      for (const photos of ['contain', 'wide', 'portrait'] as const) {
        for (const [i, cover] of (['left', 'center', 'band'] as const).entries()) {
          for (const bullets of [[], ['Conservar y aprender']]) {
            const commands = parse(
              chatDeckCommands(
                {
                  identity: {
                    ...identity,
                    photos,
                    cover,
                    rhythm: (['calm', 'balanced', 'dynamic'] as const)[i],
                    background: (['plain', 'panel', 'split'] as const)[i]
                  },
                  slides: [{ layout, title: 'Hábitats', bullets, image: { path: 'photo.png' }, imageCredit: credit }]
                },
                portrait
              )
            )
            const footerIndex = commands.findIndex((c) => c.id === 'insert.textBox' && c.p.text === credit)
            expect(footerIndex).toBeGreaterThanOrEqual(0)
            const footer = commands[footerIndex].p.rect
            expect(commands[footerIndex + 1]).toEqual({ id: 'format.size', p: { size: 12 } })
            expect(footer).toEqual([60, 490, 740, 38])
            const photo = commands.find((c) => c.id === 'insert.picture')!.p.rect
            const bleed = layout === 'cover' && photos === 'wide'
            if (bleed) {
              expect(photo).toEqual([0, 0, 960, 540])
              const backing = commands.findIndex((c) => c.id === 'shape.insert' && JSON.stringify(c.p.rect) === '[0,478,960,62]')
              expect(backing).toBeGreaterThan(commands.findIndex((c) => c.id === 'insert.picture'))
              expect(backing).toBeLessThan(footerIndex)
              expect(commands[backing + 1]).toEqual({ id: 'shape.fill', p: { color: identity.palette!.bg } })
              expect(commands.some((c) => c.id === 'picture.crop')).toBe(true)
            } else expect(footer[1] - (photo[1] + photo[3])).toBeGreaterThanOrEqual(12)
            for (const [index, command] of commands.entries()) {
              if (index !== footerIndex && command.p.rect && (!bleed || command.id === 'insert.textBox'))
                expect(intersects(footer, command.p.rect)).toBe(false)
            }
            expect(commands).toContainEqual({ id: 'design.fonts', p: { major: 'Georgia', minor: 'Verdana' } })
          }
        }
      }
    }
  )

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
  it('separa géneros con geometría real y conserva etiquetas sin imponer mayúsculas ni adornos al pie', () => {
    const concepts = [
      'Dinosaurios para niños',
      'Pastelería francesa de lujo',
      'Energía solar técnica',
      'Banda de rock en gira',
      'Clínica dental institucional'
    ]
    const layouts = concepts.map((concept) => {
      const commands = parse(
        chatDeckCommands({
          identity: { concept },
          slides: [
            { layout: 'cover', title: concept, bullets: ['Una experiencia propia'] },
            {
              layout: 'cards',
              title: 'Ideas principales',
              eyebrow: 'Para compartir',
              bullets: [
                'Mirar: un enfoque claro',
                'Crear: una propuesta propia',
                'Aprender: una idea nueva',
                'Participar: un siguiente paso'
              ]
            },
            {
              layout: 'bullets',
              title: 'Próximos pasos',
              bullets: ['Explorar el proyecto', 'Conocer las opciones', 'Compartir los resultados']
            }
          ]
        })
      )
      expect(commands.some((c) => c.p.text === 'Para compartir')).toBe(true)
      expect(commands.some((c) => c.p.text === 'PARA COMPARTIR')).toBe(false)
      expect(commands.some((c) => c.id === 'shape.insert' && c.p.rect[1] >= 500)).toBe(false)
      for (const { p } of commands.filter((c) => c.p.rect)) {
        expect(p.rect[0]).toBeGreaterThanOrEqual(0)
        expect(p.rect[1]).toBeGreaterThanOrEqual(0)
        expect(p.rect[0] + p.rect[2]).toBeLessThanOrEqual(960)
        expect(p.rect[1] + p.rect[3]).toBeLessThanOrEqual(540)
      }
      return JSON.stringify(commands.filter((c) => c.p.rect).map((c) => [c.id, c.p.rect]))
    })
    expect(new Set(layouts).size).toBe(5)
  })

  it('la portada libre de rock conserva texto y gradiente, pero aparta el círculo que lo pisaba', () => {
    const elements: NonNullable<PptxSlideSpec['elements']> = [
      { type: 'shape', shape: 'rect', x: 0, y: 0, w: 960, h: 540, fill: '#121212' },
      { type: 'shape', shape: 'ellipse', x: 560, y: -120, w: 560, h: 560, fill: '#E63946', fillTo: '#F4A261', opacity: 0.85 },
      { type: 'text', x: 60, y: 150, w: 620, h: 150, text: 'Ruta Nocturna 2027', size: 54 },
      { type: 'text', x: 60, y: 310, w: 560, h: 80, text: 'Gira latinoamericana de Los Relámpagos del Sur', size: 20 }
    ]
    const fixed = clearBleedDecorations(elements)
    expect(fixed[0]).toEqual(elements[0])
    expect(fixed.slice(2)).toEqual(elements.slice(2))
    expect(fixed[1]).toMatchObject({ type: 'shape', shape: 'ellipse', fill: '#E63946', fillTo: '#F4A261', opacity: 0.85 })
    const circle = fixed[1]
    expect(circle.x).toBeGreaterThanOrEqual(692)
    expect(circle.x + circle.w).toBeLessThanOrEqual(960)
    expect(circle.y).toBeGreaterThanOrEqual(0)
    expect(circle.y + circle.h).toBeLessThanOrEqual(540)
    expect(clearBleedDecorations(fixed)).toEqual(fixed)
    const intentional = [{ ...elements[1], x: 60, y: 150, w: 620, h: 150 }, elements[2]]
    expect(clearBleedDecorations(intentional)).toEqual(intentional)
    const commands = parse(chatDeckCommands({ slides: [{ layout: 'free', elements }] }))
    const shape = commands.filter((c) => c.id === 'shape.insert' && c.p.preset === 'ellipse')[0]
    expect(shape.p.rect).toEqual([circle.x, circle.y, circle.w, circle.h])
  })

  it.skipIf(!process.env.DECKCRAFT_CLI)('CLI real: portada a sangre con recorte proporcional, crédito visible y PNG', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lzx-bleed-photo-'))
    try {
      const file = join(dir, 'photo.png')
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGPQqAgAAAG8APFhJZwZAAAAAElFTkSuQmCC', 'base64')
      await writeFile(file, png)
      const credit = 'Foto: Autor de prueba · CC BY 4.0 · Wikimedia Commons'
      const spec: PptxSpec = {
        identity: { ...identity, photos: 'wide' },
        slides: [
          {
            layout: 'cover',
            title: 'Museo marino',
            eyebrow: 'Colección documental',
            bullets: ['Conservar y aprender'],
            image: { path: 'photo.png', alt: 'Imagen sintética de prueba' },
            imageCredit: credit
          }
        ]
      }
      const bytes = await renderChatDeck(
        process.env.DECKCRAFT_CLI!,
        spec,
        20_000,
        undefined,
        new Map([['photo.png', { ...images.get('photo.png')!, file, width: 1, height: 1, bytes: png.length }]])
      )
      const zip = await JSZip.loadAsync(bytes)
      const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
      expect(xml).toContain('Foto: Autor de prueba')
      expect(xml).toContain('CC BY 4.0')
      expect(xml).toContain('Wikimedia Commons')
      expect(xml).toMatch(/<a:srcRect[^>]*t="21875"[^>]*b="21875"/)
      expect(xml).toMatch(/<p:pic>[\s\S]*?<a:xfrm>[\s\S]*?<a:off x="0" y="0"\/>[\s\S]*?<a:ext cx="12192000" cy="6858000"/)
      expect(Object.keys(zip.files).filter((name) => /^ppt\/media\/[^/]+$/.test(name))).toHaveLength(1)
      const preview = await renderPreview('pptx', bytes, { deckcraft: process.env.DECKCRAFT_CLI!, wordcraft: null })
      expect(preview?.images).toHaveLength(1)
      expect(preview!.images[0].subarray(1, 4).toString()).toBe('PNG')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('la portada minera larga reserva tres líneas de título y separa el subtítulo', () => {
    const title = 'Bienvenido a nuestra operación minera'
    const subtitle = 'Programa de inducción para nuevos trabajadores'
    const commands = parse(
      chatDeckCommands({
        palette: { bg: '#1F2A30', text: '#F4F1EA', accent: '#E0A526' },
        fonts: { title: 'Georgia', body: 'Arial' },
        slides: [{ layout: 'cover', title, bullets: [subtitle] }]
      })
    )
    const heading = commands.findIndex((c) => c.p.text === title)
    const sub = commands.find((c) => c.p.text === subtitle)!
    expect(commands[heading + 1].p.size).toBeLessThanOrEqual(60)
    expect(commands[heading].p.rect[1] + 3 * commands[heading + 1].p.size * 1.2).toBeLessThanOrEqual(sub.p.rect[1] - 24)
  })
})
