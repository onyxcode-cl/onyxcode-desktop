import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDocxSpec, isPptxSpec, MAX_DOCX_BLOCKS, MAX_SLIDES, type DocxSpec, type PptxSpec } from '@shared/chat-doc-spec'
import { attachImageCredits, reviewImageCredits } from './image-credits'
import { renderPptx } from '../extras/render-pptx'
import { chatDeckCommands } from '../office/craft/chat-deck'
import { chatDocxCommands } from '../office/craft/chat-word'
import type { ImageMap } from './image-files'

const CREDIT =
  'Cafe interior — Alice & Bob. https://commons.wikimedia.org/wiki/File:Cafe.jpg. CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/. Reducida sin recortar.'
const ASSET = { path: 'img/cafe.jpg', credit: CREDIT }
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
const temps: string[] = []
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function imageMap(): Promise<ImageMap> {
  const dir = await mkdtemp(join(tmpdir(), 'lazunox-credit-test-'))
  temps.push(dir)
  const file = join(dir, 'cafe.png')
  await writeFile(file, PNG)
  return new Map([[ASSET.path, { file, bytes: PNG.length, ext: 'png', kind: 'png', mime: 'image/png', width: 1, height: 1 }]])
}

function pdfWithText(text: string): Buffer {
  const escaped = text.replace(/[\\()]/g, '\\$&')
  const stream = `BT /F1 10 Tf 40 700 Td (${escaped}) Tj ET`
  const bodies = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ]
  let result = '%PDF-1.4\n'
  const offsets = [0]
  bodies.forEach((body, index) => {
    offsets.push(Buffer.byteLength(result))
    result += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = Buffer.byteLength(result)
  result += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  return Buffer.from(result)
}

const xmlEscape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

describe('créditos comprobados de fotografías', () => {
  it('incrusta fotos de portada y lámina image y crédito visible completo en PPTX real', async () => {
    const spec: PptxSpec = {
      slides: [
        { layout: 'cover', title: 'Cafetería', image: { path: ASSET.path, alt: 'Interior' } },
        { layout: 'image', title: 'Local', image: { path: ASSET.path }, bullets: ['Mesas y barra'] }
      ]
    }
    const attached = attachImageCredits({ kind: 'pptx', data: spec }, [ASSET, ASSET])
    expect(attached.input.kind).toBe('pptx')
    if (attached.input.kind !== 'pptx') return
    expect(isPptxSpec(attached.input.data)).toBe(true)
    expect(spec.slides).toHaveLength(2)
    expect(attached.input.data.slides.at(-1)?.title).toContain('láminas 1, 2')
    const images = await imageMap()
    const bytes = await renderPptx(attached.input.data, images)
    const zip = await JSZip.loadAsync(bytes)
    for (const page of [1, 2]) expect(await zip.file(`ppt/slides/slide${page}.xml`)!.async('string')).toContain('<p:pic>')
    expect(Object.keys(zip.files).some((name) => /^ppt\/media\/image/.test(name))).toBe(true)
    expect((await reviewImageCredits('pptx', bytes, attached.expectedCredits)).ok).toBe(true)
    const commands = chatDeckCommands(attached.input.data, images)
    expect(commands.filter((command) => command.startsWith('insert.picture='))).toHaveLength(2)
    expect(commands.join('\n')).toContain(CREDIT)
  })

  it('Word admite imagen con pie y envía foto + crédito al motor sin reemplazar la foto con texto', async () => {
    const spec: DocxSpec = {
      title: 'Conservación',
      blocks: [{ type: 'image', path: ASSET.path, caption: 'Figura 1. Hábitat', alt: 'Hábitat', width_cm: 10 }]
    }
    const attached = attachImageCredits({ kind: 'docx', data: spec }, [ASSET])
    if (attached.input.kind !== 'docx') throw new Error('kind')
    expect(isDocxSpec(attached.input.data)).toBe(true)
    const commands = chatDocxCommands(attached.input.data, await imageMap()).flat()
    const picture = commands.findIndex((command) => command.startsWith('insert.picture='))
    expect(picture).toBeGreaterThan(-1)
    expect(commands[picture + 1]).toBe('caret.docEnd')
    expect(commands.join('\n')).toContain('Figura 1. Hábitat')
    expect(commands.join('\n')).toContain(`Imagen 1 (cafe.jpg). ${CREDIT}`)
    const zip = new JSZip()
    zip.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>${xmlEscape(CREDIT)}</w:t></w:r></w:p></w:body></w:document>`)
    expect((await reviewImageCredits('docx', await zip.generateAsync({ type: 'nodebuffer' }), attached.expectedCredits)).ok).toBe(true)
  })

  it('escapa metadatos como texto en el PDF y conserva referencia local para incrustarla después', () => {
    const attached = attachImageCredits({ kind: 'pdf', html: '<html><body><img src="img/cafe.jpg" alt="Interior"></body></html>' }, [
      { ...ASSET, credit: '<script>alert(1)</script> & Autor' }
    ])
    if (attached.input.kind !== 'pdf') throw new Error('kind')
    expect(attached.input.html).toContain('src="img/cafe.jpg"')
    expect(attached.input.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Autor')
    expect(attached.input.html).not.toContain('<script>')
    expect(attached.input.html).toContain('Recurso 1 (cafe.jpg)')
    expect(attached.input.html.indexOf('Créditos de imágenes')).toBeLessThan(attached.input.html.indexOf('</body>'))
  })

  it('el crédito no publica carpetas personales cuando PDF usa un alias absoluto autorizado', () => {
    const attached = attachImageCredits({ kind: 'pdf', html: '<html><body></body></html>' }, [
      { path: '/proyecto-privado/img/free-123.jpg', credit: CREDIT }
    ])
    if (attached.input.kind !== 'pdf') throw new Error('kind')
    expect(attached.input.html).toContain('Recurso 1 (free-123.jpg)')
    expect(attached.input.html).not.toContain('proyecto-privado')
  })

  it('revisa texto del PDF final, sin dar por bueno un crédito que solo estuviera en el HTML', async () => {
    const credit = 'Alice - CC BY 4.0 - commons.wikimedia.org'
    expect((await reviewImageCredits('pdf', pdfWithText(credit), [credit])).ok).toBe(true)
    expect((await reviewImageCredits('pdf', pdfWithText('Sin credito'), [credit])).ok).toBe(false)
    expect((await reviewImageCredits('pdf', Buffer.from('%PDF incorrecto'), [credit])).ok).toBe(false)
  })

  it('no acepta créditos solo en notas del orador o texto oculto de Word', async () => {
    const pptx = new JSZip()
    pptx.file('ppt/slides/slide1.xml', '<p:sld><a:t>Foto</a:t></p:sld>')
    pptx.file('ppt/notesSlides/notesSlide1.xml', `<a:t>${xmlEscape(CREDIT)}</a:t>`)
    expect((await reviewImageCredits('pptx', await pptx.generateAsync({ type: 'nodebuffer' }), [CREDIT])).ok).toBe(false)
    const docx = new JSZip()
    docx.file('word/document.xml', `<w:r><w:rPr><w:vanish/></w:rPr><w:t>${xmlEscape(CREDIT)}</w:t></w:r>`)
    expect((await reviewImageCredits('docx', await docx.generateAsync({ type: 'nodebuffer' }), [CREDIT])).ok).toBe(false)
  })

  it('no omite créditos largos ni supera límites del documento', () => {
    const long = `${CREDIT} `.repeat(15)
    const attached = attachImageCredits({ kind: 'pptx', data: { slides: [{ image: { path: ASSET.path } }] } }, [{ ...ASSET, credit: long }])
    if (attached.input.kind !== 'pptx') throw new Error('kind')
    expect(isPptxSpec(attached.input.data)).toBe(true)
    expect(attached.expectedCredits).toEqual([long])
    expect(() =>
      attachImageCredits(
        {
          kind: 'pptx',
          data: {
            slides: Array.from({ length: MAX_SLIDES }, (_, index) => ({
              title: String(index),
              ...(index === 0 ? { image: { path: ASSET.path } } : {})
            }))
          }
        },
        [ASSET]
      )
    ).toThrow(/No caben/)
    expect(() =>
      attachImageCredits(
        {
          kind: 'docx',
          data: {
            blocks: [
              { type: 'image', path: ASSET.path },
              ...Array.from({ length: MAX_DOCX_BLOCKS - 1 }, () => ({ type: 'paragraph' as const, text: 'Texto' }))
            ]
          }
        },
        [ASSET]
      )
    ).toThrow(/No caben/)
  })

  it('no atribuye imágenes ajenas y rechaza un layout que omitiría la fotografía', () => {
    const base = { kind: 'pptx' as const, data: { slides: [{ title: 'Sin imagen' }] } }
    expect(attachImageCredits(base, [ASSET]).expectedCredits).toEqual([])
    expect(() =>
      attachImageCredits({ kind: 'pptx', data: { slides: [{ layout: 'section', image: { path: ASSET.path } }] } }, [ASSET])
    ).toThrow(/cover o image/)
    expect(
      attachImageCredits({ kind: 'docx', data: { blocks: [{ type: 'paragraph', text: 'Sin red, sin fotos' }] } }, []).expectedCredits
    ).toEqual([])
  })
})
