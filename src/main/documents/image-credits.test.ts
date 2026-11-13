import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { isDocxSpec, isPptxSpec, MAX_DOCX_BLOCKS, MAX_SLIDES, type DocxSpec, type PptxSpec } from '@shared/chat-doc-spec'
import { attachImageCredits, imageCreditCaption, reviewImageCredits } from './image-credits'
import { renderPptx } from '../extras/render-pptx'
import { reviewDocument } from './review'
import { ensureTitlePlaceholders } from '../office/craft/pptx-titles'
import { chatDeckCommands } from '../office/craft/chat-deck'
import { chatDocxCommands } from '../office/craft/chat-word'
import h1 from './fixtures-free-images/h1-attribution-real.json'
import h6 from './fixtures-free-images/h6-attribution-real.json'
import type { ImageMap } from './image-files'

const CREDIT =
  'Cafe interior — Alice & Bob. https://commons.wikimedia.org/wiki/File:Cafe.jpg. CC BY-SA 4.0 https://creativecommons.org/licenses/by-sa/4.0/. Reducida sin recortar.'
const ASSET = {
  path: 'img/cafe.jpg',
  credit: CREDIT,
  attribution: {
    author: 'Alice & Bob',
    license: 'CC BY-SA 4.0',
    provider: 'Wikimedia Commons',
    source: 'https://commons.wikimedia.org/wiki/File:Cafe.jpg',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    notices: 'Own work',
    transformations: ['Reducción sin recorte']
  }
}
const CAPTION = imageCreditCaption(ASSET)
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
    expect(attached.input.data.slides).toHaveLength(2)
    for (const slide of attached.input.data.slides) expect(slide.imageCredit).toBe(CAPTION)
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
    expect(commands.join('\n')).toContain(CAPTION)
    expect(attached.input.data.blocks).toHaveLength(1)
    expect(spec.blocks[0]).not.toHaveProperty('caption', expect.stringContaining('Foto:'))
    const zip = new JSZip()
    zip.file('word/document.xml', `<w:document><w:body><w:p><w:r><w:t>${xmlEscape(CAPTION)}</w:t></w:r></w:p></w:body></w:document>`)
    expect((await reviewImageCredits('docx', await zip.generateAsync({ type: 'nodebuffer' }), attached.expectedCredits)).ok).toBe(true)
  })

  it('escapa metadatos como texto en el PDF y conserva referencia local para incrustarla después', () => {
    const attached = attachImageCredits({ kind: 'pdf', html: '<html><body><img src="img/cafe.jpg" alt="Interior"></body></html>' }, [
      { path: ASSET.path, credit: '<script>alert(1)</script> & Autor' }
    ])
    if (attached.input.kind !== 'pdf') throw new Error('kind')
    expect(attached.input.html).toContain('src="img/cafe.jpg"')
    expect(attached.input.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Autor')
    expect(attached.input.html).not.toContain('<script>')
    expect(attached.input.html).toContain('<small')
    expect(attached.input.html).not.toContain('break-before:page')
    expect(attached.input.html).toContain('break-inside:avoid')
    expect(attached.input.html).not.toContain('Créditos de imágenes')
    expect(attached.input.html.indexOf('<small')).toBeLessThan(attached.input.html.indexOf('</body>'))
  })

  it('el crédito no publica carpetas personales cuando PDF usa un alias absoluto autorizado', () => {
    const attached = attachImageCredits({ kind: 'pdf', html: '<html><body></body></html>' }, [
      { path: '/proyecto-privado/img/free-123.jpg', credit: CREDIT }
    ])
    if (attached.input.kind !== 'pdf') throw new Error('kind')
    expect(attached.input.html).toContain(CREDIT.replace(/&/g, '&amp;'))
    expect(attached.input.html).toContain('position:fixed!important')
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
    pptx.file('ppt/slides/slide2.xml', `<p:sld show="0"><a:t>${xmlEscape(CREDIT)}</a:t></p:sld>`)
    pptx.file('ppt/slides/slide3.xml', `<p:sld><p:sp><p:cNvPr hidden="1"/><a:t>${xmlEscape(CREDIT)}</a:t></p:sp></p:sld>`)
    expect((await reviewImageCredits('pptx', await pptx.generateAsync({ type: 'nodebuffer' }), [CREDIT])).ok).toBe(false)
    const docx = new JSZip()
    docx.file('word/document.xml', `<w:r><w:rPr><w:vanish/></w:rPr><w:t>${xmlEscape(CREDIT)}</w:t></w:r>`)
    expect((await reviewImageCredits('docx', await docx.generateAsync({ type: 'nodebuffer' }), [CREDIT])).ok).toBe(false)
  })

  it('no omite créditos largos ni supera límites del documento', () => {
    const long = `${CREDIT} `.repeat(15)
    const attached = attachImageCredits({ kind: 'pptx', data: { slides: [{ image: { path: ASSET.path } }] } }, [
      { path: ASSET.path, credit: long }
    ])
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
        [{ path: ASSET.path, credit: long }]
      )
    ).toThrow(/No caben/)
    const word = attachImageCredits(
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
    if (word.input.kind !== 'docx') throw new Error('kind')
    expect(word.input.data.blocks).toHaveLength(MAX_DOCX_BLOCKS)
    expect(isDocxSpec(word.input.data)).toBe(true)
  })

  it('mantiene tres láminas con pie de dos líneas y no pierde la nota de la persona', async () => {
    const asset = { ...ASSET, attribution: { ...ASSET.attribution, author: 'Autora de fotografía documental y paisajes del sur' } }
    const caption = imageCreditCaption(asset)
    const result = attachImageCredits(
      {
        kind: 'pptx',
        data: {
          slides: [
            { title: 'Portada', image: { path: ASSET.path }, note: 'Datos de la exposición de 2026' },
            { title: 'Contenido', bullets: ['Descripción'] },
            { title: 'Cierre' }
          ]
        }
      },
      [asset]
    )
    if (result.input.kind !== 'pptx') throw new Error('kind')
    expect(result.input.data.slides).toHaveLength(3)
    expect(result.input.data.slides[0].imageCredit).toContain(caption)
    expect(result.input.data.slides[0].imageCredit!.length).toBeLessThanOrEqual(160)
    expect(isPptxSpec(result.input.data)).toBe(true)
    const bytes = await renderPptx(result.input.data, await imageMap())
    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))).toHaveLength(3)
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain(xmlEscape(caption))
    expect(xml).toContain('Datos de la exposición')
    expect((await reviewImageCredits('pptx', bytes, result.expectedCredits)).ok).toBe(true)
    const commands = chatDeckCommands(result.input.data, await imageMap()).join('\n')
    expect(commands).toContain(caption)
    expect(commands).toContain('[60,490,840,38]')
  })

  it('reutiliza el pie PDF inmediato, conserva los enlaces y no crea sección ni crédito duplicado', () => {
    const html = `<html><body><h1>Museo</h1><img src="img/cafe.jpg"><figcaption>${xmlEscape(CAPTION)}</figcaption></body></html>`
    const result = attachImageCredits({ kind: 'pdf', html }, [ASSET])
    if (result.input.kind !== 'pdf') throw new Error('kind')
    expect(result.input.html.match(/Foto:/g)).toHaveLength(1)
    expect(result.input.html).not.toContain('<section')
    expect(result.input.html).not.toContain('<aside')
    expect(result.input.html).toContain('href="https://creativecommons.org/licenses/by-sa/4.0/"')
    expect(result.input.html).toContain('href="https://commons.wikimedia.org/wiki/File:Cafe.jpg"')
    expect(result.expectedCredits).toEqual([CAPTION])
    const second = attachImageCredits(result.input, [ASSET])
    if (second.input.kind !== 'pdf') throw new Error('kind')
    expect(second.input.html.match(/Foto:/g)).toHaveLength(1)
  })

  it('pone crédito bajo cada foto Word repetida y no confía en un crédito PDF distante u oculto', () => {
    const word = attachImageCredits(
      {
        kind: 'docx',
        data: {
          blocks: [
            { type: 'image', path: ASSET.path, caption: 'Hábitat' },
            { type: 'paragraph', text: 'Texto' },
            { type: 'image', path: ASSET.path }
          ]
        }
      },
      [ASSET]
    )
    if (word.input.kind !== 'docx') throw new Error('kind')
    for (const block of word.input.data.blocks) if (block.type === 'image') expect(block.caption).toContain(CAPTION)
    expect(word.input.data.blocks).toHaveLength(3)
    const result = attachImageCredits({ kind: 'pdf', html: `<body><!-- ${CAPTION} --><img src="img/cafe.jpg"><p>Descripción</p></body>` }, [
      ASSET
    ])
    if (result.input.kind !== 'pdf') throw new Error('kind')
    expect(result.input.html).toContain('visibility:visible!important')
    expect(result.input.html).toContain('</small><p>Descripción</p>')
    expect(result.expectedCredits).toEqual([CAPTION])
  })

  it.each(['', 'Figura 1. Interior del museo. '])(
    'completa un pie PDF parcial sin duplicarlo y conserva descripción: %s',
    (description) => {
      const html = `<body><img src="img/cafe.jpg"><figcaption>${description}Foto: Alice &amp; Bob · CC BY-SA 4.0 · Wikimedia Commons</figcaption></body>`
      const result = attachImageCredits({ kind: 'pdf', html }, [ASSET])
      if (result.input.kind !== 'pdf') throw new Error('kind')
      expect(result.input.html.match(/Foto:/g)).toHaveLength(1)
      expect(result.input.html).toContain(xmlEscape(CAPTION))
      expect(result.input.html).toContain(description)
      expect(result.input.html).not.toContain('<figcaption')
      expect(result.expectedCredits).toEqual([CAPTION])
    }
  )

  it.each(['Foto: Otra persona · CC BY-SA 4.0', 'Foto: Alice & Bob · CC BY 4.0'])(
    'no acepta como atribución comprobada un pie parcial con otro autor o licencia: %s',
    (caption) => {
      const result = attachImageCredits({ kind: 'pdf', html: `<img src="img/cafe.jpg"><p>${xmlEscape(caption)}</p>` }, [ASSET])
      if (result.input.kind !== 'pdf') throw new Error('kind')
      expect(result.input.html).toContain(xmlEscape(CAPTION))
      expect(result.expectedCredits).toEqual([CAPTION])
    }
  )

  it('no atribuye al data-src ni al img comentado y mantiene el pie corto ante avisos largos', () => {
    const result = attachImageCredits(
      {
        kind: 'pdf',
        html: `<body><!-- <img src="img/cafe.jpg"> --><img data-src="img/cafe.jpg" src="otro.jpg"><img alt="a > b" src="img/cafe.jpg"></body>`
      },
      [ASSET]
    )
    if (result.input.kind !== 'pdf') throw new Error('kind')
    expect(result.input.html).toContain('<img data-src="img/cafe.jpg" src="otro.jpg"><img')
    expect(result.input.html.match(/Foto:/g)).toHaveLength(1)
    expect(result.input.html).toContain('<!-- <img src="img/cafe.jpg"> -->')
    const asset = { ...ASSET, attribution: { ...ASSET.attribution, notices: 'Atribución adicional requerida por el autor. '.repeat(8) } }
    const word = attachImageCredits({ kind: 'docx', data: { blocks: [{ type: 'image', path: ASSET.path }] } }, [asset])
    if (word.input.kind !== 'docx') throw new Error('kind')
    expect(isDocxSpec(word.input.data)).toBe(true)
    expect(word.input.data.blocks[0]).toHaveProperty('caption', imageCreditCaption(asset))
    expect(imageCreditCaption(asset).length).toBeLessThanOrEqual(120)
    const slides = attachImageCredits({ kind: 'pptx', data: { slides: [{ title: 'Foto real de prueba', image: { path: ASSET.path } }] } }, [
      asset
    ])
    if (slides.input.kind !== 'pptx') throw new Error('kind')
    expect(slides.input.data.slides).toHaveLength(1)
    expect(slides.expectedCredits).toEqual([imageCreditCaption(asset)])
    expect(isPptxSpec(slides.input.data)).toBe(true)
  })

  it('acepta espacios, puntuación y mayúsculas al comprobar los archivos finales, pero no cambia autor ni licencia', async () => {
    const variant = 'FOTO: ALICE & BOB — CC BY-SA 4.0 / WIKIMEDIA COMMONS / AJUSTADA'
    for (const kind of ['docx', 'pptx'] as const) {
      const zip = new JSZip()
      const path = kind === 'docx' ? 'word/document.xml' : 'ppt/slides/slide1.xml'
      zip.file(path, `<a:t>${xmlEscape(variant)}</a:t>`)
      const bytes = await zip.generateAsync({ type: 'nodebuffer' })
      expect((await reviewImageCredits(kind, bytes, [CAPTION])).ok).toBe(true)
      const wrong = await reviewImageCredits(kind, bytes, [CAPTION.replace('4.0', '3.0')])
      expect(wrong.ok).toBe(false)
      expect(wrong.items[0].text).toContain(CAPTION.replace('4.0', '3.0'))
      expect(wrong.items[0].text).toContain('misma página o lámina')
    }
  })

  it('corrige el pie copiado en Word/PPTX/PDF sin duplicar créditos ni agregar páginas o láminas', () => {
    const copied = 'Figura 1. Interior. FOTO: ALICE & BOB — CC BY-SA 4.0 — WIKIMEDIA COMMONS'
    const word = attachImageCredits({ kind: 'docx', data: { blocks: [{ type: 'image', path: ASSET.path, caption: copied }] } }, [ASSET])
    if (word.input.kind !== 'docx') throw new Error('kind')
    expect(word.input.data.blocks[0]).toHaveProperty('caption', `Figura 1. Interior. ${CAPTION}`)
    const slides = attachImageCredits({ kind: 'pptx', data: { slides: [{ image: { path: ASSET.path }, note: copied }] } }, [ASSET])
    if (slides.input.kind !== 'pptx') throw new Error('kind')
    expect(slides.input.data.slides).toHaveLength(1)
    expect(slides.input.data.slides[0].imageCredit).toBe(`Figura 1. Interior. ${CAPTION}`)
    const pdf = attachImageCredits({ kind: 'pdf', html: `<img src="${ASSET.path}"><p>${xmlEscape(copied)}</p>` }, [ASSET])
    if (pdf.input.kind !== 'pdf') throw new Error('kind')
    expect(pdf.input.html.match(/Foto:/g)).toHaveLength(1)
    expect(pdf.input.html).toContain('Figura 1. Interior.')
    expect(pdf.expectedCredits).toEqual([CAPTION])
  })

  it.each([h1, h6])('inserta el crédito real limpio de $title sin copiarlo el modelo', async (raw) => {
    const asset = { path: ASSET.path, credit: raw.credit, attribution: { ...raw, fullCredit: raw.credit } }
    const caption = imageCreditCaption(asset)
    const slides = attachImageCredits({ kind: 'pptx', data: { slides: [{ title: raw.title, image: { path: ASSET.path } }] } }, [asset])
    if (slides.input.kind !== 'pptx') throw new Error('kind')
    const bytes = await ensureTitlePlaceholders(await renderPptx(slides.input.data, await imageMap()))
    expect(slides.input.data.slides).toHaveLength(1)
    expect(slides.input.data.slides[0].imageCredit).toBe(caption)
    expect(slides.input.data.slides[0].speaker_notes).toContain(raw.credit)
    expect((await reviewImageCredits('pptx', bytes, slides.expectedCredits)).ok).toBe(true)
    const review = await reviewDocument('pptx', bytes, slides.input.data)
    expect(review.items.filter((item) => !item.ok).map((item) => item.text)).toEqual([])
    const word = attachImageCredits({ kind: 'docx', data: { blocks: [{ type: 'image', path: ASSET.path, caption: raw.credit }] } }, [asset])
    if (word.input.kind !== 'docx') throw new Error('kind')
    expect(word.input.data.blocks[0]).toHaveProperty('caption', caption)
    const pdf = attachImageCredits({ kind: 'pdf', html: `<img src="${ASSET.path}"><p>${xmlEscape(raw.credit)}</p>` }, [asset])
    if (pdf.input.kind !== 'pdf') throw new Error('kind')
    expect(pdf.input.html).toContain(xmlEscape(caption))
    expect(pdf.input.html).not.toContain(raw.notices)
    expect(pdf.input.html.match(/<small/g)).toHaveLength(1)
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
