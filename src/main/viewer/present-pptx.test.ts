import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { realpathSync, renameSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { posixOnly } from '../../test/platform'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ binary: vi.fn(), raster: vi.fn(), convert: vi.fn(), present: vi.fn(), tmp: vi.fn() }))
vi.mock('../documents/engine', () => ({ craftBinary: mocks.binary }))
vi.mock('../documents/pdf-raster', () => ({ rasterizePdf: mocks.raster }))
vi.mock('../office/craft/chat-deck', () => ({ deckToPdf: mocks.convert }))
vi.mock('../office/craft/private-tmp', () => ({ privateTmp: mocks.tmp }))
vi.mock('../extras/artifact-window', () => ({ presentSlides: mocks.present }))
import { importPptxAttachment, MAX_PRESENTATION_SLIDES, pptxSlideCount, presentPptxFile, renderedPptxHtml } from './present-pptx'

async function deck(n = 2): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    'ppt/presentation.xml',
    `<p:presentation><p:sldIdLst>${Array.from({ length: n }, (_, i) => `<p:sldId id="${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`
  )
  return zip.generateAsync({ type: 'nodebuffer' })
}
let root: string
beforeEach(async () => {
  root = realpathSync(await mkdtemp(join(tmpdir(), 'lzx-present-pptx-test-')))
  mocks.binary.mockReturnValue('fake-deckcraft')
  mocks.tmp.mockResolvedValue(root)
  mocks.present.mockResolvedValue(null)
  mocks.raster.mockResolvedValue({ pages: 2, images: [Buffer.from('first'), Buffer.from('second')] })
  mocks.convert.mockImplementation(async (_binary, _input, output) => {
    await writeFile(output, '%PDF fake')
    return output
  })
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('presentación de PPTX importado', () => {
  it('rechaza ZIP ajeno, corrupto, vacío y el exceso sobre las 40 láminas', async () => {
    expect(MAX_PRESENTATION_SLIDES).toBe(40)
    for (const bytes of [Buffer.from('bad'), await new JSZip().generateAsync({ type: 'nodebuffer' }), await deck(0)])
      await expect(pptxSlideCount(bytes)).rejects.toThrow(/válido|láminas/)
    await expect(pptxSlideCount(await deck(41))).rejects.toThrow('40')
    expect(await pptxSlideCount(await deck(40))).toBe(40)
  })
  it('el nombre del adjunto no se usa como ruta y deduplica los bytes', async () => {
    const bytes = await deck()
    const path = await importPptxAttachment(root, '../../escape.pptx', bytes.toString('base64'))
    expect(path.startsWith(join(root, 'adjuntos') + '/')).toBe(true)
    expect(await readFile(path)).toEqual(bytes)
    expect(await importPptxAttachment(root, 'otro.pptx', bytes.toString('base64'))).toBe(path)
    await expect(importPptxAttachment(root, 'file.ppt', bytes.toString('base64'))).rejects.toThrow()
    await expect(importPptxAttachment(root, 'file.pptx', 'file:///etc/passwd')).rejects.toThrow()
  })
  it('falla completo al faltar una lámina o al sobrepasar el presupuesto', () => {
    expect(() => renderedPptxHtml([Buffer.from('a')], 2, 2)).toThrow('2')
    expect(() => renderedPptxHtml([Buffer.from('a'), Buffer.alloc(0)], 2, 2)).toThrow('lámina 2')
    expect(() => renderedPptxHtml([Buffer.alloc(19 * 1024 * 1024)], 1, 1)).toThrow('memoria')
  })
  it('conserva todas las imágenes y usa el presentador común; limpia el temporal al cancelar', async () => {
    const input = join(root, 'input.pptx')
    await writeFile(input, await deck())
    await presentPptxFile(input, (path) => path)
    expect(mocks.raster).toHaveBeenCalledWith(expect.any(Buffer), 2, 3840)
    expect(mocks.present).toHaveBeenCalledWith(expect.objectContaining({ html: expect.stringContaining('data:image/png;base64,Zmlyc3Q=') }))
    expect(await readdir(root)).toEqual(['input.pptx'])
  })
  it.each(['conversion', 'raster', 'missing'])('no proyecta ni deja temporales después de fallo %s', async (failure) => {
    const input = join(root, 'input.pptx')
    await writeFile(input, await deck())
    if (failure === 'conversion') mocks.convert.mockResolvedValueOnce(null)
    if (failure === 'raster') mocks.raster.mockRejectedValueOnce(new Error('failed slide'))
    if (failure === 'missing') mocks.raster.mockResolvedValueOnce({ pages: 1, images: [Buffer.from('one')] })
    await expect(presentPptxFile(input, (path) => path)).rejects.toThrow()
    expect(mocks.present).not.toHaveBeenCalled()
    expect(await readdir(root)).toEqual(['input.pptx'])
  })
  it('sin motor no presenta la vista estructural', async () => {
    const input = join(root, 'input.pptx')
    await writeFile(input, await deck())
    mocks.binary.mockReturnValueOnce(null)
    await expect(presentPptxFile(input, (path) => path)).rejects.toThrow('Instala')
    expect(mocks.present).not.toHaveBeenCalled()
  })
})

// Fixture de symlinks sin privilegios (Windows requiere permiso propio).
it.skipIf(!posixOnly)('rechaza un enlace final y una carpeta cambiada antes de copiar bytes al motor', async () => {
  const owned = join(root, 'owned')
  const outside = join(root, 'outside')
  await mkdir(owned)
  await mkdir(outside)
  await writeFile(join(outside, 'deck.pptx'), await deck())
  const linked = join(owned, 'linked.pptx')
  await symlink(join(outside, 'deck.pptx'), linked)
  await expect(presentPptxFile(linked, (path) => path)).rejects.toThrow()
  await writeFile(join(owned, 'deck.pptx'), await deck())
  let first = true
  const authorize = (path: string): string => {
    if (first) {
      first = false
      renameSync(owned, join(root, 'old-owned'))
      symlinkSync(outside, owned, 'dir')
      return path
    }
    if (path.startsWith(outside)) throw new Error('scope revoked')
    return path
  }
  await expect(presentPptxFile(join(owned, 'deck.pptx'), authorize)).rejects.toThrow('scope revoked')
  expect(mocks.convert).not.toHaveBeenCalled()
  expect(mocks.present).not.toHaveBeenCalled()
})
