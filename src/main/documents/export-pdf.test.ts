import { mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exportDocumentPdf, MAX_EXPORTED_PDF_BYTES } from './export-pdf'
import { setPrivateTmpBase } from '../office/craft/private-tmp'
import { CraftTimeoutError } from '../office/craft/craft-run'
import { renderChatDocx } from '../office/craft/chat-word'
import { renderPptx } from '../extras/render-pptx'
import { renderPreview } from './preview'
import type { ImageMap, ResolvedImage } from './image-files'
import JSZip from 'jszip'
import type { DocxBlock } from '@shared/chat-doc-spec'

let input: Buffer
async function sourceZip(content = '<w:p><w:r><w:t>Documento intacto</w:t></w:r></w:p>', rels = '', slides = 1): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('word/document.xml', `<w:document>${content}</w:document>`)
  zip.file('word/_rels/document.xml.rels', rels)
  zip.file('ppt/presentation.xml', `<p:presentation>${'<p:sldId id="1"/>'.repeat(slides)}</p:presentation>`)
  zip.file('ppt/slides/slide1.xml', '<p:sld/>')
  return zip.generateAsync({ type: 'nodebuffer' })
}
const tools = { wordcraft: '/motor/wordcraft-cli', deckcraft: '/motor/deckcraft-cli' }
const minimalPdf = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF'
)
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'lzx-pdf-export-test-'))
  setPrivateTmpBase(root)
  input = await sourceZip()
})
afterEach(async () => {
  setPrivateTmpBase(null)
  await rm(root, { recursive: true, force: true })
})

describe('exportación del documento original a PDF', () => {
  it.each(['docx', 'pptx'] as const)('%s: entrega bytes intactos al convert del motor y limpia temporales', async (tipo) => {
    const run = vi.fn(async (binary: string, args: string[], timeout: number) => {
      expect(binary).toBe(tipo === 'docx' ? tools.wordcraft : tools.deckcraft)
      expect(args[0]).toBe('convert')
      expect(args[1]).toBe(join(dirname(args[2]), `documento.${tipo}`))
      expect(await readFile(args[1])).toEqual(input)
      expect(timeout).toBe(1700)
      await writeFile(args[2], minimalPdf)
    })
    expect(await exportDocumentPdf(tipo, input, tools, { run, timeoutMs: 1700 })).toEqual(minimalPdf)
    expect(run).toHaveBeenCalledTimes(1)
    expect(await readdir(root)).toEqual([])
  })
  it('sin motor no reconstruye ni entrega una versión parcial', async () => {
    const run = vi.fn()
    await expect(exportDocumentPdf('docx', input, { ...tools, wordcraft: null }, { run })).rejects.toThrow(
      /No está disponible.*No lo entregues/
    )
    expect(run).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual([])
  })
  it.each([Buffer.from('texto'), Buffer.alloc(25 * 1024 * 1024 + 1)])('rechaza entradas inválidas o excesivas', async (bytes) => {
    const run = vi.fn()
    await expect(exportDocumentPdf('docx', bytes, tools, { run })).rejects.toThrow(/origen no es válido/)
    expect(run).not.toHaveBeenCalled()
  })
  it.each([new Error('falló'), new CraftTimeoutError()])('no hay salida alternativa al fallar o vencer el motor', async (error) => {
    const run = vi.fn(async () => {
      throw error
    })
    await expect(exportDocumentPdf('docx', input, tools, { run })).rejects.toThrow(/exportar_pdf.*no lo reconstruyas/)
    expect(await readdir(root)).toEqual([])
  })
  it.each([Buffer.from('no es PDF'), Buffer.from('%PDF-1.4\nroto')])('rechaza PDF corrupto aunque el motor termine bien', async (bytes) => {
    await expect(
      exportDocumentPdf('pptx', input, tools, {
        run: async (_bin, args) => {
          await writeFile(args[2], bytes)
        }
      })
    ).rejects.toThrow(/PDF válido|No se pudo exportar/)
    expect(await readdir(root)).toEqual([])
  })
  it('rechaza salida demasiado grande sin leerla completa', async () => {
    await expect(
      exportDocumentPdf('docx', input, tools, {
        run: async (_bin, args) => {
          const fh = await open(args[2], 'w')
          try {
            await fh.truncate(MAX_EXPORTED_PDF_BYTES + 1)
          } finally {
            await fh.close()
          }
        }
      })
    ).rejects.toThrow(/50 MB/)
    expect(await readdir(root)).toEqual([])
  })
  it('bloquea PDF que pierde una foto JPEG comprobada en el original', async () => {
    const source = await sourceZip(
      '<w:p><w:drawing><a:blip r:embed="rId1"/></w:drawing></w:p>',
      '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/foto.jpg"/></Relationships>'
    )
    await expect(
      exportDocumentPdf('docx', source, tools, {
        run: async (_bin, args) => {
          await writeFile(args[2], minimalPdf)
        }
      })
    ).rejects.toThrow(/perdió fotos/)
  })
  it('bloquea PDF que pierde el crédito visible de una foto', async () => {
    const source = await sourceZip('<w:p><w:r><w:t>Foto: Autora · CC BY 4.0 · Wikimedia Commons</w:t></w:r></w:p>')
    await expect(
      exportDocumentPdf('docx', source, tools, {
        run: async (_bin, args) => {
          await writeFile(args[2], minimalPdf)
        }
      })
    ).rejects.toThrow(/perdió un crédito/)
  })
  it('bloquea conversión que reduce el número de láminas', async () => {
    const source = await sourceZip('', '', 2)
    await expect(
      exportDocumentPdf('pptx', source, tools, {
        run: async (_bin, args) => {
          await writeFile(args[2], minimalPdf)
        }
      })
    ).rejects.toThrow(/perdió o añadió láminas/)
  })
  it('rechaza enlace en lugar de la salida', async () => {
    await expect(
      exportDocumentPdf('docx', input, tools, {
        run: async (_bin, args) => {
          await symlink(args[1], args[2])
        }
      })
    ).rejects.toThrow(/archivo PDF normal/)
    expect(await readdir(root)).toEqual([])
  })
})

const wordcraft = process.env.WORDCRAFT_CLI
const deckcraft = process.env.DECKCRAFT_CLI
const photos = [
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAIAAAD8YgW4AAABPElEQVR4nO3UgYkDARDDwPsh/dccvojESxAYFyCE/p7n8Wg+DOH1/0/zaQiB9h3PAi3QfqlpGS3Q5hpmtDm40uHmarRAm2uY0ebgSoebq9ECba5hRpuDKx1urkYLtLmGGW0OrnS4uRot0OYaZrQ5uNLh5mq0QJtrmNHm4EqHm6vRAm2uYUabgysdbq5GC7S5hhltDq50uLkaLdDmGma0ObjS4eZqtECba5jR5uBKh5ur0QJtrmFGm4MrHW6uRgu0uYYZbQ6udLi5Gi3Q5hpmtDm40uHmarRAm2uY0ebgSoebq9ECba5hRpuDKx1urkYLtLmGGW0OrnS4uRot0OYaZrQ5uNLh5mq0QJtrmNHm4EqHm6vRAm2uYUabgysdbq5GC7S5hhltDq50uLkaLdDmGma0ObjS4eZqtO+AfgPV0ldk5lZ0WgAAAABJRU5ErkJggg==',
  'iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAIAAAD8YgW4AAABPklEQVR4nO3UgWlDARDD0J9HJ+r+w5UOkfgIAuMBhNDr93k8mjdD+Pn/p3k3hED7jGeBFmjf1LSMFmhzDTPaHFzpcHM1WqDNNcxoc3Clw83VaIE21zCjzcGVDjdXowXaXMOMNgdXOtxcjRZocw0z2hxc6XBzNVqgzTXMaHNwpcPN1WiBNtcwo83BlQ43V6MF2lzDjDYHVzrcXI0WaHMNM9ocXOlwczVaoM01zGhzcKXDzdVogTbXMKPNwZUON1ejBdpcw4w2B1c63FyNFmhzDTPaHFzpcHM1WqDNNcxoc3Clw83VaIE21zCjzcGVDjdXowXaXMOMNgdXOtxcjRZocw0z2hxc6XBzNVqgzTXMaHNwpcPN1WiBNtcwo83BlQ43V6MF2lzDjDYHVzrcXI0WaHMNM9ocXOlwczXaZ0D/AaDLV5Z3Dl6eAAAAAElFTkSuQmCC'
].map((p) => Buffer.from(p, 'base64'))
async function imageMap(format: 'png' | 'jpg' = 'png'): Promise<ImageMap> {
  const images = new Map<string, ResolvedImage>()
  for (const [i, png] of photos.entries()) {
    const bytes = format === 'png' ? png : await readFile(new URL('./fixtures-free-images/synthetic-exif-6.jpg', import.meta.url))
    const path = `foto-${i}.${format}`,
      file = join(root, path)
    await writeFile(file, bytes)
    images.set(path, {
      file,
      bytes: bytes.length,
      width: 120,
      height: 90,
      kind: format === 'jpg' ? 'jpeg' : 'png',
      ext: format,
      mime: format === 'png' ? 'image/png' : 'image/jpeg'
    })
  }
  return images
}
async function checkTwoPagesWithPhotosAndCredits(bytes: Buffer): Promise<void> {
  const { getDocument, OPS } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, verbosity: 0 })
  try {
    const doc = await task.promise
    expect(doc.numPages).toBe(2)
    for (let i = 1; i <= 2; i++) {
      const page = await doc.getPage(i)
      const text = (await page.getTextContent()).items.map((v) => ('str' in v ? v.str : '')).join(' ')
      expect(text).toContain(`Foto: Autora ${i}`)
      expect(text).toContain('CC BY 4.0')
      const operations = await page.getOperatorList()
      expect(operations.fnArray.some((op) => op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject)).toBe(true)
    }
  } finally {
    await task.destroy()
  }
}
describe('motores reales sin interfaz', () => {
  it.skipIf(!wordcraft).each(['png', 'jpg'] as const)(
    'Word → PDF (%s): mismas dos páginas, dos imágenes incrustadas y sus créditos visibles',
    async (format) => {
      const images = await imageMap(format)
      const blocks: DocxBlock[] = []
      for (let i = 0; i < 2; i++) {
        if (i) blocks.push({ type: 'page_break' })
        blocks.push(
          { type: 'heading', level: 1, text: `Conservación marina ${i + 1}` },
          { type: 'paragraph', text: 'Informe del hábitat y seguimiento de la costa.' },
          { type: 'image', path: `foto-${i}.${format}`, width_cm: 6, caption: `Foto: Autora ${i + 1} · CC BY 4.0 · Wikimedia Commons` }
        )
      }
      const docx = await renderChatDocx(wordcraft!, { title: 'Conservación marina', cover: false, blocks }, 20_000, images)
      const before = await renderPreview('docx', docx, { wordcraft: wordcraft!, deckcraft: null }, { totalMs: 20_000 })
      expect(before).toMatchObject({ pages: 2, status: 'complete' })
      const pdf = await exportDocumentPdf('docx', docx, { wordcraft: wordcraft!, deckcraft: null })
      await checkTwoPagesWithPhotosAndCredits(pdf)
    },
    60_000
  )
  it.skipIf(!deckcraft)(
    'PowerPoint → PDF: dos láminas, fotos y créditos en cada página',
    async () => {
      const images = await imageMap()
      const pptx = await renderPptx(
        {
          slides: [0, 1].map((i) => ({
            title: `Conservación marina ${i + 1}`,
            layout: 'image' as const,
            image: { path: `foto-${i}.png`, alt: 'Hábitat marino' },
            imageCredit: `Foto: Autora ${i + 1} · CC BY 4.0 · Wikimedia Commons`
          }))
        },
        images
      )
      const pdf = await exportDocumentPdf('pptx', pptx, { wordcraft: null, deckcraft: deckcraft! })
      await checkTwoPagesWithPhotosAndCredits(pdf)
    },
    60_000
  )
})
