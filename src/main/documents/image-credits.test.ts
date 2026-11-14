import { afterEach, describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderPptx } from '../extras/render-pptx'
import { chatDeckCommands } from '../office/craft/chat-deck'
import { chatDocxCommands } from '../office/craft/chat-word'
import type { ImageMap } from './image-files'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
const temps: string[] = []
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function imageMap(): Promise<ImageMap> {
  const dir = await mkdtemp(join(tmpdir(), 'lazunox-credit-test-'))
  temps.push(dir)
  const file = join(dir, 'foto.png')
  await writeFile(file, PNG)
  return new Map([['img/foto.png', { file, bytes: PNG.length, ext: 'png', kind: 'png', mime: 'image/png', width: 1, height: 1 }]])
}

describe('fotos sin créditos automáticos', () => {
  it('PPTX incrusta la foto sin pie automático en el archivo ni en comandos DeckCraft', async () => {
    const spec = { slides: [{ layout: 'cover' as const, title: 'Paisaje', image: { path: 'img/foto.png' } }] }
    const images = await imageMap()
    const zip = await JSZip.loadAsync(await renderPptx(spec, images))
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain('<p:pic>')
    expect(xml).not.toContain('Foto:')
    const commands = chatDeckCommands(spec, images).join('\n')
    expect(commands).toContain('insert.picture=')
    expect(commands).not.toContain('Foto:')
  })

  it('Word inserta foto sin pie y conserva intacto el pie explícito pedido por la persona', async () => {
    const images = await imageMap()
    const commands = chatDocxCommands({ blocks: [{ type: 'image', path: 'img/foto.png' }] }, images)
      .flat()
      .join('\n')
    expect(commands).toContain('insert.picture=')
    expect(commands).not.toContain('Foto:')
    const caption = 'Foto: crédito personalizado solicitado por la persona'
    const explicit = chatDocxCommands({ blocks: [{ type: 'image', path: 'img/foto.png', caption }] }, images)
      .flat()
      .join('\n')
    expect(explicit).toContain(caption)
  })

  it('PPTX conserva el crédito explícito y las notas sin completar autor ni licencia', async () => {
    const caption = 'Foto: crédito personalizado solicitado por la persona'
    const spec = {
      slides: [
        { layout: 'image' as const, title: 'Paisaje', image: { path: 'img/foto.png' }, imageCredit: caption, speaker_notes: 'Nota propia' }
      ]
    }
    const images = await imageMap()
    const zip = await JSZip.loadAsync(await renderPptx(spec, images))
    expect(await zip.file('ppt/slides/slide1.xml')!.async('string')).toContain(caption)
    const commands = chatDeckCommands(spec, images).join('\n')
    expect(commands).toContain(caption)
    expect(commands).toContain('Nota propia')
  })
})
