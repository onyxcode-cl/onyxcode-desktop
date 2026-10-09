import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { assembleSlidesPptx } from './slides-deck-pptx'

/** PNG transparente de 1×1 — alcanza para probar el armado del `.pptx` (contenido de imagen real, no hace falta que se vea nada). */
const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

async function slideXmls(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf)
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const out: string[] = []
  for (const name of names) out.push(await zip.file(name)!.async('string'))
  return out
}

async function mediaFiles(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf)
  return Object.keys(zip.files).filter((n) => /^ppt\/media\/.+/.test(n))
}

describe('assembleSlidesPptx: un deck `​```slides` capturado como imágenes → .pptx proyectable', () => {
  it('una diapositiva por imagen, en el mismo orden', async () => {
    const buf = await assembleSlidesPptx([TINY_PNG, TINY_PNG, TINY_PNG])
    expect(buf.subarray(0, 2).toString()).toBe('PK') // firma de archivo zip (.pptx es un zip)
    const slides = await slideXmls(buf)
    expect(slides).toHaveLength(3)
    const media = await mediaFiles(buf)
    expect(media).toHaveLength(3)
  })

  it('cada diapositiva es la imagen a PANTALLA COMPLETA (x=0,y=0, 10×5.625in en EMU) — nunca texto', async () => {
    const buf = await assembleSlidesPptx([TINY_PNG])
    const [slide] = await slideXmls(buf)
    expect(slide).toContain('<a:off x="0" y="0"/>')
    expect(slide).toContain('<a:ext cx="9144000" cy="5143500"/>') // 10in×5.625in en EMU (914400/in)
    expect(slide).not.toContain('<a:t>') // sin texto: es una foto, a propósito (F8-B135)
  })

  it('una sola diapositiva si solo llega una imagen', async () => {
    const buf = await assembleSlidesPptx([TINY_PNG])
    const slides = await slideXmls(buf)
    expect(slides).toHaveLength(1)
  })
})
