import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { renderChatDocx } from './chat-word'
import { renderPreview } from '../../documents/preview'

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
})
