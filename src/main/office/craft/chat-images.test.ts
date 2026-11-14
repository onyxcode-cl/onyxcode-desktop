/** Imágenes en los comandos de DeckCraft y WordCraft y en el respaldo de pptxgenjs: solo con una copia validada; nunca con la ruta que escribió el modelo. */
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { isDocxSpec, isPptxSpec, MAX_IMAGES_PER_DOC, type DocxSpec, type PptxSpec } from '@shared/chat-doc-spec'
import type { ImageMap, ResolvedImage } from '../../documents/image-files'
import { renderPptx } from '../../extras/render-pptx'
import { chatDeckCommands } from './chat-deck'
import { chatDocxCommands } from './chat-word'

const COPIA = '/privado/lazunox-img-abc/img-1.png'
const img = (w = 400, h = 200): ResolvedImage => ({
  kind: 'png',
  mime: 'image/png',
  ext: 'png',
  width: w,
  height: h,
  file: COPIA,
  bytes: 10
})
const mapOf = (rel: string, i = img()): ImageMap => new Map([[rel, i]])
const j = (c: string): any => JSON.parse(c.slice(c.indexOf('=') + 1))

const PPTX: PptxSpec = {
  slides: [
    { title: 'Portada', bullets: ['sub'] },
    {
      title: 'Nuestro logo',
      layout: 'image',
      image: { path: 'img/logo.png', alt: 'Logo de la empresa' },
      bullets: ['Simple', 'Reconocible']
    }
  ]
}
const DOCX: DocxSpec = {
  blocks: [
    { type: 'paragraph', text: 'Hola' },
    { type: 'image', path: 'img/logo.png', alt: 'Logo', width_cm: 8, caption: 'Figura 1. Logo' }
  ]
}

describe('esquema', () => {
  it('lámina de imagen y bloque de imagen válidos', () => {
    expect(isPptxSpec(PPTX)).toBe(true)
    expect(isDocxSpec(DOCX)).toBe(true)
  })
  it('la lámina «image» exige la imagen', () => {
    expect(isPptxSpec({ slides: [{ title: 'x', layout: 'image' }] })).toBe(false)
  })
  it.each([
    'https://evil.example/x.png',
    'file:///etc/passwd',
    '/etc/passwd',
    'C:\\x.png',
    '../x.png',
    '~/x.png',
    'data:image/png;base64,AAAA',
    '',
    'a\u0000.png'
  ])('rechaza la ruta %j', (p) => {
    expect(isPptxSpec({ slides: [{ title: 'x' }, { title: 'y', layout: 'image', image: { path: p } }] })).toBe(false)
    expect(isDocxSpec({ blocks: [{ type: 'image', path: p }] })).toBe(false)
  })
  it('tope de imágenes por documento y de ancho en Word', () => {
    const many = Array.from({ length: MAX_IMAGES_PER_DOC + 1 }, (_, i) => ({ type: 'image' as const, path: `img/${i}.png` }))
    expect(isDocxSpec({ blocks: many })).toBe(false)
    expect(isDocxSpec({ blocks: many.slice(0, MAX_IMAGES_PER_DOC) })).toBe(true)
    expect(isDocxSpec({ blocks: [{ type: 'image', path: 'a.png', width_cm: 40 }] })).toBe(false)
    const slides = Array.from({ length: MAX_IMAGES_PER_DOC + 1 }, (_, i) => ({
      title: 'x',
      layout: 'image' as const,
      image: { path: `img/${i}.png` }
    }))
    expect(isPptxSpec({ slides })).toBe(false)
  })
  it('no admite campos de más en la imagen', () => {
    expect(isDocxSpec({ blocks: [{ type: 'image', path: 'a.png', url: 'https://x' }] })).toBe(false)
    expect(isPptxSpec({ slides: [{ title: 'x' }, { title: 'y', layout: 'image', image: { path: 'a.png', url: 'https://x' } }] })).toBe(
      false
    )
  })
})

describe('DeckCraft', () => {
  it('inserta la COPIA temporal, centrada y con la proporción de la imagen, y su texto alternativo', () => {
    const cmds = chatDeckCommands(PPTX, mapOf('img/logo.png'))
    const pic = cmds.find((c) => c.startsWith('insert.picture='))!
    const p = j(pic)
    expect(p.path).toBe(COPIA)
    const [x, y, w, h] = p.rect as number[]
    expect(w / h).toBeCloseTo(2, 1)
    expect(x).toBeGreaterThanOrEqual(60)
    expect(x + w).toBeLessThanOrEqual(900)
    const textBoxes = cmds
      .filter((c) => c.startsWith('insert.textBox='))
      .map(j)
      .filter((box) => ['Simple', 'Reconocible'].includes(box.text))
    for (const box of textBoxes) {
      const [tx, ty, tw, th] = box.rect
      expect(tx >= x + w || tx + tw <= x || ty >= y + h || ty + th <= y).toBe(true)
    }
    expect(y + h).toBeLessThanOrEqual(146 + 336)
    expect(cmds.some((c) => c.startsWith('shape.altText=') && j(c).text === 'Logo de la empresa')).toBe(true)
    expect(cmds.join('\n')).not.toContain('img/logo.png') // la ruta del modelo no llega a ArtCraft
  })
  it('sin viñetas la imagen usa todo el ancho', () => {
    const cmds = chatDeckCommands(
      {
        slides: [
          { title: 'P', bullets: ['s'] },
          { title: 'L', layout: 'image', image: { path: 'a.png' } }
        ]
      },
      mapOf('a.png', img(1600, 400))
    )
    const [, , w] = j(cmds.find((c) => c.startsWith('insert.picture='))!).rect as number[]
    expect(w).toBe(840)
  })
  it('sin copia validada (Chat, o no se pudo leer) NO inserta nada y la lámina queda como título + viñetas', () => {
    for (const images of [undefined, new Map() as ImageMap]) {
      const cmds = chatDeckCommands(PPTX, images)
      expect(cmds.some((c) => c.startsWith('insert.picture='))).toBe(false)
      expect(cmds.join('\n')).not.toContain('img/logo.png')
      expect(cmds.some((c) => c.startsWith('insert.textBox=') && j(c).text === 'Simple')).toBe(true)
    }
  })
  it('una diapositiva con `image` y sin layout se trata como lámina de imagen', () => {
    const cmds = chatDeckCommands(
      {
        slides: [
          { title: 'P', bullets: ['s'] },
          { title: 'L', image: { path: 'a.png' } }
        ]
      },
      mapOf('a.png')
    )
    expect(cmds.some((c) => c.startsWith('insert.picture='))).toBe(true)
  })
})

describe('WordCraft', () => {
  const flat = (spec: DocxSpec, images?: ImageMap): string[] => chatDocxCommands(spec, images).flat()
  it('inserta la COPIA, centrada, con el ancho en puntos y el pie de figura', () => {
    const c = flat(DOCX, mapOf('img/logo.png'))
    const pic = c.find((l) => l.startsWith('insert.picture='))!
    expect(j(pic)).toEqual({ path: COPIA, width: 226.8, alt: 'Logo' })
    expect(c.join('\n')).not.toContain('img/logo.png')
    expect(c.some((l) => l.startsWith('text.insert=') && j(l).text === 'Figura 1. Logo')).toBe(true)
  })
  it('después de la imagen el cursor va al final ANTES de crear el párrafo (si no, WordCraft borra la imagen seleccionada)', () => {
    const names = flat(DOCX, mapOf('img/logo.png')).map((l) => l.split('=')[0])
    const i = names.indexOf('insert.picture')
    expect(names.slice(i, i + 3)).toEqual(['insert.picture', 'caret.docEnd', 'text.newParagraph'])
  })
  it('el ancho nunca pasa de la página útil (16 cm) y por defecto son 12 cm', () => {
    const w = (width_cm?: number): number =>
      j(flat({ blocks: [{ type: 'image', path: 'a.png', width_cm }] }, mapOf('a.png')).find((l) => l.startsWith('insert.picture='))!).width
    expect(w(undefined)).toBe(340.2)
    expect(w(16)).toBe(453.6)
  })
  it('sin copia validada el bloque se omite (nunca se usa la ruta del modelo)', () => {
    for (const images of [undefined, new Map() as ImageMap]) {
      const c = flat(DOCX, images)
      expect(c.some((l) => l.startsWith('insert.picture='))).toBe(false)
      expect(c.join('\n')).not.toContain('img/logo.png')
    }
  })
})

describe('respaldo con pptxgenjs', () => {
  const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  it('la lámina de imagen incrusta el archivo (ppt/media) y las viñetas van al lado', async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = mkdtempSync(join(tmpdir(), 'lzx-pptximg-'))
    try {
      const file = join(dir, 'img-1.png')
      writeFileSync(file, PNG1)
      const buf = await renderPptx(PPTX, new Map([['img/logo.png', { ...img(1, 1), file }]]))
      const zip = await JSZip.loadAsync(buf)
      expect(Object.keys(zip.files).some((n) => /^ppt\/media\/.*\.png$/.test(n))).toBe(true)
      const sl = await zip.file('ppt/slides/slide2.xml')!.async('string')
      expect(sl).toContain('Logo de la empresa')
      expect(sl).toContain('Simple')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('sin copia validada no hay medios y la lámina sale con sus viñetas', async () => {
    const zip = await JSZip.loadAsync(await renderPptx(PPTX))
    expect(Object.keys(zip.files).some((n) => /^ppt\/media\/.+/.test(n))).toBe(false)
    expect(await zip.file('ppt/slides/slide2.xml')!.async('string')).toContain('Simple')
  })
})
