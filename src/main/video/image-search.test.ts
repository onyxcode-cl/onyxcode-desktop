import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { VideoImagesService } from './image-search'
import { searchWebImages } from './image-search-providers'
import { ImageSearchStore } from './image-search-store'
import { FreeImageRegistry } from '../documents/free-image-registry'
import type { FreeImageSearch } from '../documents/free-images'
import type { downloadVideoMedia } from './web-media'

const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})
const temp = async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'lzx-video-search-test-')))
  dirs.push(dir)
  return dir
}
function jpg() {
  const b = Buffer.alloc(30)
  b.set([255, 216, 255, 192])
  b.writeUInt16BE(17, 4)
  b[6] = 8
  b.writeUInt16BE(800, 7)
  b.writeUInt16BE(1200, 9)
  return b
}
const photo = {
  title: 'Fortnite Battle Royale',
  source: 'https://www.epicgames.com/fortnite',
  url: 'https://cdn.example.com/fortnite.jpg',
  thumb: 'https://cdn.example.com/thumb.jpg',
  width: 1200,
  height: 800
}
const input: FreeImageSearch = {
  uso: 'video',
  queries: ['Fortnite Battle Royale', 'Fortnite juego'],
  requirements: { subject: 'Fortnite', usage: 'Promo', realPhoto: false }
}
const evaluation = { mode: 'visual' as const, observed: 'Se ve el juego.', meets: ['Fortnite'], doubts: '' }
const processor = { normalize: vi.fn(async () => jpg()), sheet: vi.fn(async () => Buffer.from('hoja numerada')) }
const download: typeof downloadVideoMedia = vi.fn(async (origin, kind) => ({
  bytes: jpg(),
  ext: 'jpg',
  provenance: { origen: origin, urlFinal: origin, tipo: kind, sha256: createHash('sha256').update(jpg()).digest('hex') }
}))
function service(extra = {}) {
  return new VideoImagesService({
    config: () => ({ provider: 'serper', keys: { serper: 'test-placeholder' } }),
    processor,
    search: vi.fn(async () => [photo]),
    download,
    ...extra
  })
}

it('buscador general: tema de juego, hoja, revisión, persistencia y exclusión de documentos', async () => {
  const s = service(),
    found = await s.search(input),
    id = found.candidates[0]!.id
  expect(found.sheet).toEqual(Buffer.from('hoja numerada'))
  expect(found.candidates[0]).toMatchObject({ title: 'Fortnite Battle Royale', uso: 'video', license: 'Sin dato' })
  await expect(s.use(id, evaluation)).rejects.toThrow('Primero')
  expect(await s.view([id])).toHaveLength(1)
  const asset = await s.use(id, evaluation)
  expect(asset.provenance).toMatchObject({ uso: 'video', provider: 'Serper', status: 'licencia-registrada' })
  const dir = await temp(),
    root = join(dir, 'project'),
    registry = new FreeImageRegistry(join(dir, 'private'))
  await mkdir(root)
  await registry.remember(root, id, 'img/free-01234567890123456789.jpg', asset)
  expect((await registry.findId(root, id, 'video'))?.asset.bytes).toEqual(jpg())
  expect(await registry.findId(root, id)).toBeNull()
  expect(await registry.get(root, asset.provenance.sha256)).toBeNull()
})
it('rechaza usar si cambió la foto después de verla', async () => {
  let sha = 'a'
  const s = service({
    download: async (origin: string, kind: 'photo' | 'audio') => ({
      bytes: jpg(),
      ext: 'jpg',
      provenance: { origen: origin, urlFinal: origin, tipo: kind, sha256: sha }
    })
  })
  const found = await s.search(input),
    id = found.candidates[0]!.id
  await s.view([id])
  sha = 'b'
  await expect(s.use(id, evaluation)).rejects.toThrow('Cambió')
})
it('una ampliación mixta fallida no autoriza fotos de catálogo sin entregar sus píxeles', async () => {
  let fail = false
  const fallback = { search: vi.fn(), view: vi.fn(), use: vi.fn() }
  const s = service({
    fallback,
    download: async (...args: Parameters<typeof downloadVideoMedia>) => {
      if (fail) throw Error('falló original')
      return download(...args)
    }
  })
  const id = (await s.search(input)).candidates[0]!.id
  fail = true
  await expect(s.view(['catalogo-id', id])).rejects.toThrow('falló original')
  expect(fallback.view).not.toHaveBeenCalled()
  await expect(s.use(id, evaluation)).rejects.toThrow('Primero')
})
it('sin clave avisa y usa catálogos; documentos nunca consultan el proveedor general', async () => {
  const fallback = {
      search: vi.fn(async () => ({ searchId: 'fallback', round: 1, candidates: [], mimeType: 'image/png' as const })),
      view: vi.fn(),
      use: vi.fn()
    },
    search = vi.fn()
  const s = service({ config: () => ({ provider: 'serper', keys: {} }), fallback, search })
  expect((await s.search(input)).notice).toContain('Sin clave')
  await s.search({ ...input, uso: 'documento' })
  expect(fallback.search).toHaveBeenCalledTimes(2)
  expect(search).not.toHaveBeenCalled()
})
it('limita rondas, rechaza ids ajenos y conserva uso video', async () => {
  const s = service(),
    first = await s.search(input)
  await expect(s.search({ ...input, uso: 'documento', searchId: first.searchId })).rejects.toThrow('uso')
  await expect(s.search({ ...input, searchId: 'web-falso' })).rejects.toThrow('searchId')
  await s.search({ queries: input.queries, searchId: first.searchId })
  await expect(s.search({ ...input, searchId: first.searchId })).rejects.toThrow('límite')
})
it.each(['serper', 'brave'] as const)('%s usa su API, clave solo hacia ese destino y parámetros del proveedor', async (provider) => {
  const fetcher = vi.fn(async (url, init) => {
    const u = new URL(String(url))
    expect(init.redirect).toBe('error')
    expect(u.href).not.toContain('test-placeholder')
    if (provider === 'serper') {
      expect(u.href).toBe('https://google.serper.dev/images')
      expect(init.headers['X-API-KEY']).toBe('test-placeholder')
      expect(JSON.parse(init.body).q).toBe('Fortnite')
    } else {
      expect(u.hostname).toBe('api.search.brave.com')
      expect(u.searchParams.get('q')).toBe('Fortnite')
      expect(init.headers['X-Subscription-Token']).toBe('test-placeholder')
    }
    return Response.json(
      provider === 'serper'
        ? {
            images: [
              { title: photo.title, link: photo.source, imageUrl: photo.url, thumbnailUrl: photo.thumb, imageWidth: 1200, imageHeight: 800 }
            ]
          }
        : {
            results: [
              {
                title: photo.title,
                url: photo.source,
                properties: { url: photo.url, width: 1200, height: 800 },
                thumbnail: { src: photo.thumb }
              }
            ]
          }
    )
  }) as unknown as typeof fetch
  expect(await searchWebImages(provider, 'test-placeholder', 'Fortnite', new AbortController().signal, fetcher)).toEqual([photo])
})
it('claves cifradas, estado sin secretos, cambio de proveedor y borrado', async () => {
  const dir = await temp()
  const safe = {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(Buffer.from(s).map((n) => n ^ 0xaa)),
    decryptString: (b: Buffer) => Buffer.from(b.map((n) => n ^ 0xaa)).toString()
  }
  const store = new ImageSearchStore(dir, safe)
  store.save('serper', 'test-placeholder')
  expect((await readFile(join(dir, 'video-image-search.bin'))).includes(Buffer.from('test-placeholder'))).toBe(false)
  expect(JSON.stringify(store.status())).not.toContain('test-placeholder')
  store.save('brave', 'other-placeholder')
  store.save('serper')
  expect(store.read().keys).toEqual({ serper: 'test-placeholder', brave: 'other-placeholder' })
  store.save('serper', '')
  expect(store.status().configured).toEqual({ serper: false, brave: true })
  const unavailable = new ImageSearchStore(dir, { ...safe, isEncryptionAvailable: () => false })
  await writeFile(join(dir, 'video-image-search.bin'), 'unchanged')
  expect(() => unavailable.save('serper', 'x')).toThrow('seguro')
  expect(await readFile(join(dir, 'video-image-search.bin'), 'utf8')).toBe('unchanged')
})

it('prefiere búsquedas sin personas en primer plano para sujetos que no son personas', async () => {
  const search = vi.fn<typeof searchWebImages>(async () => [photo])
  await service({ search }).search({ uso: 'video', queries: ['coffee', 'cappuccino'], requirements: { subject: 'café', usage: 'promo' } })
  expect(search.mock.calls[0][2]).toBe('coffee -people -portrait')
  search.mockClear()
  await service({ search }).search({
    uso: 'video',
    queries: ['portrait', 'retrato'],
    requirements: { subject: 'retratos de personas', usage: 'promo' }
  })
  expect(search.mock.calls[0][2]).toBe('portrait')
})
