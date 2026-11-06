import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import JSZip from 'jszip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { docxXmlToText, previewFile } from './files'

const realPlatform = process.platform
function setPlatform(p: string): void {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

describe('vista previa de .docx en Windows', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lzx-docx-'))
    setPlatform('win32')
  })
  afterEach(() => {
    setPlatform(realPlatform)
    rmSync(dir, { recursive: true, force: true })
  })

  const wrap = (body: string): string =>
    `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`

  it('extrae el texto con salto por párrafo', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', wrap('<w:p><w:r><w:t>Hola &amp; adiós</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">Segundo</w:t></w:r></w:p>'))
    const p = join(dir, 'a.docx')
    writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer' }))
    const r = await previewFile(p)
    expect(r).toMatchObject({ kind: 'text', content: 'Hola & adiós\nSegundo', truncated: false })
  })

  it('rechaza una bomba de descompresión', async () => {
    const zip = new JSZip()
    zip.file('word/document.xml', wrap('<w:p><w:t>' + 'a'.repeat(20 * 1024 * 1024) + '</w:t></w:p>'), {
      compression: 'DEFLATE'
    })
    const p = join(dir, 'bomba.docx')
    writeFileSync(p, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    expect((await previewFile(p)).kind).toBe('unsupported')
  })

  it('rechaza zips con demasiadas entradas, sin document.xml o corruptos', async () => {
    const many = new JSZip()
    for (let i = 0; i < 5100; i++) many.file(`f${i}.txt`, 'x')
    many.file('word/document.xml', wrap(''))
    const p1 = join(dir, 'muchas.docx')
    writeFileSync(p1, await many.generateAsync({ type: 'nodebuffer' }))
    expect((await previewFile(p1)).kind).toBe('unsupported')

    const none = new JSZip()
    none.file('otro.xml', '<a/>')
    const p2 = join(dir, 'sin.docx')
    writeFileSync(p2, await none.generateAsync({ type: 'nodebuffer' }))
    expect((await previewFile(p2)).kind).toBe('unsupported')

    const p3 = join(dir, 'roto.docx')
    writeFileSync(p3, Buffer.concat([Buffer.from('PK'), Buffer.alloc(50, 7)]))
    expect((await previewFile(p3)).kind).toBe('unsupported')
  })

  it('.rtf y .odt siguen sin vista previa en Windows', async () => {
    const p = join(dir, 'a.rtf')
    writeFileSync(p, '{\\rtf1 hola}')
    expect((await previewFile(p)).kind).toBe('unsupported')
  })

  it('docxXmlToText decodifica entidades numéricas', () => {
    expect(docxXmlToText('<w:p><w:t>&#65;&#x42;</w:t></w:p>')).toBe('AB')
  })
})
