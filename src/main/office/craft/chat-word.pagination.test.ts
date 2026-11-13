import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { renderChatDocx } from './chat-word'
import { renderPreview } from '../../documents/preview'
import { attachImageCredits, imageCreditCaption } from '../../documents/image-credits'
import type { DocxBlock } from '@shared/chat-doc-spec'

const binary = process.env.WORDCRAFT_CLI
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH7sAAAAASUVORK5CYII=', 'base64')

describe.skipIf(!binary)('Word con foto y crédito: motor real sin interfaz', () => {
  it('conserva foto, texto y crédito; solo compacta párrafo vacío final y confirma total de páginas', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lzx-word-pages-'))
    try {
      const photo = join(dir, 'foto.png')
      await writeFile(photo, png)
      const bytes = await renderChatDocx(
        binary!,
        {
          title: 'Informe de fauna',
          cover: false,
          blocks: [
            { type: 'heading', level: 1, text: 'Fauna local' },
            { type: 'image', path: 'foto.png', caption: 'Figura. Foto de prueba', width_cm: 3 },
            { type: 'bullets', items: ['Protección local', 'Seguimiento anual'] },
            { type: 'heading', level: 1, text: 'Créditos de imágenes' },
            { type: 'paragraph', text: 'Autora de prueba, CC BY 4.0.' }
          ]
        },
        20_000,
        new Map([['foto.png', { kind: 'png', mime: 'image/png', ext: 'png', width: 1, height: 1, bytes: png.length, file: photo }]])
      )
      const zip = await JSZip.loadAsync(bytes)
      const xml = await zip.file('word/document.xml')!.async('string')
      expect(Object.keys(zip.files).some((name) => name.startsWith('word/media/'))).toBe(true)
      expect(xml).toContain('<w:drawing>')
      expect(xml).toContain('Autora de prueba, CC BY 4.0.')
      expect(xml).toContain('Protección local')
      const paragraphs = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map((match) => match[0])
      const credit = paragraphs.find((p) => p.includes('Autora de prueba'))!
      expect(credit).toContain('<w:sz w:val="22"')
      expect(paragraphs.at(-1)).toContain('<w:sz w:val="2"')
      expect(paragraphs.at(-1)).not.toMatch(/<w:t[ >]/)
      const preview = await renderPreview('docx', bytes, { wordcraft: binary!, deckcraft: null }, { totalMs: 20_000 })
      expect(preview).toMatchObject({ pages: 1, status: 'complete', truncated: false })
      expect(preview?.images).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 45_000)
  it.each([1, 2])(
    'inserta pie local breve sin añadir páginas a informe de %i página(s)',
    async (pages) => {
      const dir = await mkdtemp(join(tmpdir(), 'lzx-word-caption-'))
      try {
        const photo = join(dir, 'foto.png')
        await writeFile(photo, png)
        const asset = {
          path: 'foto.png',
          credit: 'Autora de prueba · CC BY 4.0 · https://commons.wikimedia.org/wiki/File:Photo.jpg',
          attribution: {
            author: 'Autora de prueba',
            license: 'CC BY 4.0',
            provider: 'Wikimedia Commons',
            source: 'https://commons.wikimedia.org/wiki/File:Photo.jpg',
            licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
            transformations: ['Reducida sin recorte']
          }
        }
        const blocks: DocxBlock[] = [
          { type: 'heading', level: 1, text: 'Fauna local' },
          { type: 'image', path: 'foto.png', width_cm: 3, caption: 'Figura 1. Hábitat' },
          { type: 'paragraph', text: 'La conservación depende del cuidado del hábitat.' }
        ]
        if (pages === 2)
          blocks.push(
            { type: 'page_break' },
            { type: 'heading', level: 1, text: 'Seguimiento' },
            { type: 'image', path: 'foto.png', width_cm: 3, caption: 'Figura 2. Observación' },
            { type: 'paragraph', text: 'Se realizan observaciones durante todo el año.' }
          )
        const prepared = attachImageCredits({ kind: 'docx', data: { title: 'Informe de fauna', cover: false, blocks } }, [asset])
        if (prepared.input.kind !== 'docx') throw new Error('kind')
        const bytes = await renderChatDocx(
          binary!,
          prepared.input.data,
          20_000,
          new Map([['foto.png', { kind: 'png', mime: 'image/png', ext: 'png', width: 1, height: 1, bytes: png.length, file: photo }]])
        )
        const zip = await JSZip.loadAsync(bytes)
        const xml = await zip.file('word/document.xml')!.async('string')
        const captions = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].filter(
          (match) => !match[0].includes('<w:drawing>') && match[0].includes(imageCreditCaption(asset))
        )
        expect(captions).toHaveLength(pages)
        for (const caption of captions) {
          expect(caption[0]).toContain('<w:sz w:val="18"')
          expect(caption[0]).not.toContain(asset.attribution.licenseUrl)
          expect(caption[0]).not.toContain(asset.attribution.source)
          expect(caption[0]).toContain('<w:keepLines/>')
          expect(caption[0]).toContain('w:line="240"')
          expect(caption[0]).toContain('w:after="60"')
        }
        expect(xml).not.toContain('Créditos de imágenes')
        const preview = await renderPreview('docx', bytes, { wordcraft: binary!, deckcraft: null }, { totalMs: 20_000 })
        expect(preview).toMatchObject({ pages, status: 'complete', truncated: false })
        expect(preview?.images).toHaveLength(pages)
      } finally {
        await rm(dir, { recursive: true, force: true })
      }
    },
    45_000
  )
  it('dos fotos distintas de 6 cm y pies locales en flujo continuo conservan dos páginas reales', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lzx-word-two-photos-'))
    const photos = [
      'iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAIAAAD8YgW4AAAAuUlEQVR4nO3QAQkAIADAMCMazDgGtIXCHTzA2Zhr60Lj+cEngQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINutUBkPDu0JBrKAsAAAAASUVORK5CYII=',
      'iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAIAAAD8YgW4AAAAuUlEQVR4nO3QAQkAIADAMIMZzBCGtoXCHTzA2Zhr60Lj+cEngQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINuhVo0K1Ag24FGnQr0KBbgQbdCjToVqBBtwINutUBWiW/DWN1qr0AAAAASUVORK5CYII='
    ].map((data) => Buffer.from(data, 'base64'))
    try {
      const assets = photos.map((_, i) => ({
        path: `foto-${i}.png`,
        credit: `Autora ${i} · CC BY 4.0 · https://commons.wikimedia.org/wiki/File:Example_${'long_'.repeat(40)}${i}.jpg`,
        attribution: {
          author: `Autora ${i}`,
          license: 'CC BY 4.0',
          provider: 'Wikimedia Commons',
          source: `https://commons.wikimedia.org/wiki/File:Example_${'long_'.repeat(40)}${i}.jpg`,
          licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
          notices: 'Own work. ' + 'Información adicional de procedencia. '.repeat(50)
        }
      }))
      const images = new Map<
        string,
        { kind: 'png'; mime: string; ext: string; width: number; height: number; bytes: number; file: string }
      >()
      for (const [i, bytes] of photos.entries()) {
        const file = join(dir, assets[i].path)
        await writeFile(file, bytes)
        images.set(assets[i].path, { kind: 'png', mime: 'image/png', ext: 'png', width: 120, height: 90, bytes: bytes.length, file })
      }
      const paragraph =
        'La conservación marina requiere observar las especies y proteger sus hábitats. Las comunidades costeras participan en el seguimiento del océano y registran los cambios de su entorno.'
      const blocks: DocxBlock[] = []
      for (let i = 0; i < 2; i++) {
        blocks.push(
          { type: 'heading', level: 1, text: i ? 'Seguimiento de la costa' : 'Hábitats marinos' },
          { type: 'paragraph', text: paragraph },
          { type: 'image', path: assets[i].path, width_cm: 6, caption: `Figura ${i + 1}. Hábitat observado.` },
          { type: 'paragraph', text: paragraph },
          {
            type: 'bullets',
            items: [
              'Seguimiento del estado del hábitat.',
              'Participación de las comunidades locales.',
              'Registro periódico de las observaciones.'
            ]
          },
          { type: 'paragraph', text: paragraph }
        )
      }
      const prepared = attachImageCredits({ kind: 'docx', data: { title: 'Conservación marina', cover: false, blocks } }, assets)
      if (prepared.input.kind !== 'docx') throw new Error('kind')
      const bytes = await renderChatDocx(binary!, prepared.input.data, 20_000, images)
      const zip = await JSZip.loadAsync(bytes)
      const xml = await zip.file('word/document.xml')!.async('string')
      expect(Object.keys(zip.files).filter((name) => /^word\/media\/[^/]+$/.test(name))).toHaveLength(2)
      expect(xml.match(/<w:drawing>/g)).toHaveLength(2)
      expect(xml).not.toContain('w:type="page"')
      expect(xml).not.toContain('https://')
      expect(xml).not.toContain('Información adicional')
      for (const asset of assets) {
        const caption = imageCreditCaption(asset)
        expect(caption.length).toBeLessThanOrEqual(120)
        expect(xml).toContain(caption)
        const paragraphXml = [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].find(
          (p) => !p[0].includes('<w:drawing>') && p[0].includes(caption)
        )![0]
        expect(paragraphXml).toContain('<w:keepLines/>')
        expect(paragraphXml).toContain('w:line="240"')
        expect(paragraphXml).toContain('w:after="60"')
      }
      const preview = await renderPreview('docx', bytes, { wordcraft: binary!, deckcraft: null }, { totalMs: 20_000 })
      expect(preview).toMatchObject({ pages: 2, status: 'complete', truncated: false })
      expect(preview?.images).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }, 45_000)
})
