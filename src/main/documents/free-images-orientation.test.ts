import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import { FreeImagesService, parseCommonsImages } from './free-images'
import { jpegOrientation } from './jpeg-orientation'
import { sniffImage } from './image-files'
import type { FreeImageProcessor } from './free-images-visual'

function jpeg(width: number, height: number, orientation = 1): Buffer {
  const bytes = Buffer.alloc(70)
  bytes.set([0xff, 0xd8, 0xff, 0xe1, 0, 34])
  bytes.write('Exif\0\0', 6, 'latin1')
  bytes.write('II', 12)
  bytes.writeUInt16LE(42, 14)
  bytes.writeUInt32LE(8, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(0x112, 22)
  bytes.writeUInt16LE(3, 24)
  bytes.writeUInt32LE(1, 26)
  bytes.writeUInt16LE(orientation, 30)
  bytes.set([0xff, 0xc0, 0, 17, 8], 38)
  bytes.writeUInt16BE(height, 43)
  bytes.writeUInt16BE(width, 45)
  return bytes
}
const processor: FreeImageProcessor = {
  normalize: async (bytes, edge) => {
    const info = sniffImage(bytes)!
    const [width, height] = jpegOrientation(bytes) >= 5 ? [info.height, info.width] : [info.width, info.height]
    const scale = Math.min(1, edge / Math.max(width, height))
    return jpeg(Math.round(width * scale), Math.round(height * scale))
  },
  sheet: async () => Buffer.from('sheet')
}
const search = {
  queries: ['fruit market', 'fruit market stalls'],
  requirements: { subject: 'fruit market', usage: 'afiche', orientation: 'vertical' as const }
}
const evaluation = { mode: 'visual' as const, observed: 'Puestos de frutas.', meets: ['mercado'], doubts: '' }
async function setup(failSecond = false, spoofOrientation = false, tamperedOriginal = false) {
  const fixture = JSON.parse(await readFile(new URL('./fixtures-free-images/h6-orientation.json', import.meta.url), 'utf8'))
  const downloads = new Map<string, Buffer>()
  for (let i = 0; i < fixture.query.pages.length; i++) {
    const file = fixture.query.pages[i].imageinfo[0]
    const original = i === 0 ? jpeg(2484, 3496) : jpeg(4000, 3000, spoofOrientation ? 1 : 6)
    file.sha1 = createHash('sha1').update(original).digest('hex')
    if (tamperedOriginal && i === 1) original[original.length - 1] = 1
    downloads.set(file.url, failSecond && i === 1 ? Buffer.from('bad bytes') : original)
    downloads.set(file.thumburl, jpeg(file.thumbwidth, file.thumbheight))
  }
  const fetch = vi.fn(async (url: string | URL | Request) => {
    const u = String(url)
    return u.startsWith('https://commons.wikimedia.org/w/api.php')
      ? Response.json(fixture)
      : new Response(new Uint8Array(downloads.get(u)!))
  }) as typeof globalThis.fetch
  const service = new FreeImagesService({ fetch, processor })
  const found = await service.search(search)
  expect(found.candidates).toHaveLength(2)
  return { service, ids: found.candidates.map((c) => c.id), fixture }
}
describe('h6: dos finalistas, segunda JPEG girada mediante EXIF', () => {
  it('compara las dimensiones visibles de Commons y entrega las dos ampliaciones', async () => {
    const { service, ids, fixture } = await setup()
    expect(parseCommonsImages(fixture)[1]).toMatchObject({ width: 3000, height: 4000 })
    const views = await service.view(ids)
    expect(views).toHaveLength(2)
    expect(sniffImage(views[1].image)).toMatchObject({ width: 960, height: 1280 })
    const used = await service.use(ids[1], evaluation)
    expect(used.provenance).toMatchObject({ width: 1440, height: 1920 })
  })
  it('no permite usar la primera foto si la segunda hizo fallar toda la respuesta', async () => {
    const { service, ids } = await setup(true)
    await expect(service.view(ids)).rejects.toThrow(`falló la candidata ${ids[1]}`)
    await expect(service.use(ids[0], evaluation)).rejects.toThrow('Primero amplía')
    expect(await service.view([ids[0]])).toHaveLength(1)
    await expect(service.use(ids[0], evaluation)).resolves.toMatchObject({ ext: 'jpg' })
  })
  it('sigue exigiendo SHA1 aunque la orientación y las dimensiones coincidan', async () => {
    const { service, ids } = await setup(false, false, true)
    await expect(service.view([ids[1]])).rejects.toThrow('no corresponde a la versión revisada')
  })
  it('no acepta dimensiones intercambiadas sin EXIF que lo justifique', async () => {
    const { service, ids } = await setup(false, true)
    await expect(service.view([ids[1]])).rejects.toThrow('no es una imagen válida')
  })
})
