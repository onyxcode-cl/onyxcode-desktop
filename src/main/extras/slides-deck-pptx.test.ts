import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { assembleSlidesPptx, writeSlidesPptx, MAX_SLIDES_PPTX_BYTES } from './slides-deck-pptx'
import { testSlidePng } from './slides-png-fixture'
import { mkdtemp, writeFile, readFile, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PNG_4K = testSlidePng()

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
    const buf = await assembleSlidesPptx([PNG_4K, PNG_4K, PNG_4K])
    expect(buf.subarray(0, 2).toString()).toBe('PK') // firma de archivo zip (.pptx es un zip)
    const slides = await slideXmls(buf)
    expect(slides).toHaveLength(3)
    const media = await mediaFiles(buf)
    expect(media).toHaveLength(3)
  })

  it('cada diapositiva es la imagen a PANTALLA COMPLETA (x=0,y=0, 10×5.625in en EMU) — nunca texto', async () => {
    const buf = await assembleSlidesPptx([PNG_4K])
    const [slide] = await slideXmls(buf)
    expect(slide).toContain('<a:off x="0" y="0"/>')
    expect(slide).toContain('<a:ext cx="9144000" cy="5143500"/>') // 10in×5.625in en EMU (914400/in)
    expect(slide).not.toContain('<a:t>') // sin texto: es una foto, a propósito (F8-B135)
  })

  it('una sola diapositiva si solo llega una imagen', async () => {
    const buf = await assembleSlidesPptx([PNG_4K])
    const slides = await slideXmls(buf)
    expect(slides).toHaveLength(1)
  })
})

describe('contrato 4K y ensamblado secuencial', () => {
  it('rechaza capturas pequeñas con medidas y explicación claras', async () => {
    await expect(assembleSlidesPptx([testSlidePng(960, 540)])).rejects.toThrow('960×540; se requieren 3840×2160')
  })
  it('conserva exactamente los bytes PNG de cada archivo dentro del ZIP', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slides-zip-test-'))
    try {
      const files = [join(dir, 'one.png'), join(dir, 'two.png')]
      for (const file of files) await writeFile(file, PNG_4K)
      const output = join(dir, 'out.pptx')
      await writeSlidesPptx(files, output)
      const data = await readFile(output)
      expect(await slideXmls(data)).toHaveLength(2)
      const zip = await JSZip.loadAsync(data)
      const names = await mediaFiles(data)
      expect(names).toHaveLength(2)
      for (const name of names) {
        const bytes = await zip.file(name)!.async('nodebuffer')
        expect(bytes.equals(PNG_4K)).toBe(true)
        expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([3840, 2160])
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
  it('rechaza cero láminas y el exceso sin truncarlo', async () => {
    await expect(assembleSlidesPptx([])).rejects.toThrow('entre 1 y 40')
    await expect(assembleSlidesPptx(Array.from({ length: 41 }, () => PNG_4K))).rejects.toThrow('entre 1 y 40')
  })
  it('rechaza el exceso de peso antes de leerlo, sin bajar la resolución', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'slides-budget-test-'))
    try {
      const path = join(dir, 'large.png')
      await writeFile(path, PNG_4K)
      await truncate(path, MAX_SLIDES_PPTX_BYTES + 1)
      await expect(writeSlidesPptx([path], join(dir, 'out.pptx'))).rejects.toThrow('supera 256 MiB')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
