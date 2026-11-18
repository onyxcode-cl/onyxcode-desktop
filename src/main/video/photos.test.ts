/** Full photo search/view/use -> persistent authority -> video tools, without Electron or live providers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile, copyFile, realpath } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { FreeImagesService } from '../documents/free-images'
import { FreeImageRegistry } from '../documents/free-image-registry'
import { DocumentsMcpServer, type DocumentsBinding } from '../documents/mcp-server'
import { ChatPhotosMcpServer } from '../documents/chat-photos'
import { CODE_BINDING_FOLDER } from '@shared/documents-permissions'
import { VideoMcpServer, type VideoBinding } from './mcp-server'
import { resolveVideoPhoto } from './photos'
import type { RenderJob } from './render-process'

vi.mock('../documents/free-images-visual', async (original) => ({
  ...(await original<typeof import('../documents/free-images-visual')>()),
  protectFreeImagePreview: async (bytes: Buffer) => bytes
}))
class Photos extends DocumentsMcpServer {
  invoke(binding: DocumentsBinding, name: string, args: Record<string, unknown>) {
    return this.callTool(binding, name, args)
  }
}
class ChatPhotos extends ChatPhotosMcpServer {
  invoke(name: string, args: Record<string, unknown>) {
    return this.callTool({ folder: '<chat>', activeSession: async () => 'ses_video' }, name, args)
  }
}
class Video extends VideoMcpServer {
  invoke(binding: VideoBinding, name: string, args: Record<string, unknown>) {
    return this.callTool(binding, name, args)
  }
}
function jpeg(width: number, height: number): Buffer {
  const b = Buffer.alloc(30)
  b.set([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8])
  b.writeUInt16BE(height, 7)
  b.writeUInt16BE(width, 9)
  return b
}
const bytes = jpeg(1200, 800)
const sha1 = createHash('sha1').update(bytes).digest('hex')
const raw = {
  query: {
    pages: [
      {
        pageid: 1,
        title: 'File:Coffee shop interior.jpg',
        imageinfo: [
          {
            url: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cafe.jpg',
            thumburl: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Cafe.jpg',
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Cafe.jpg',
            width: 1200,
            height: 800,
            thumbwidth: 1200,
            thumbheight: 800,
            size: bytes.length,
            mime: 'image/jpeg',
            sha1,
            extmetadata: {
              Artist: { value: 'Fotógrafa' },
              LicenseShortName: { value: 'All rights reserved' },
              License: { value: 'copyright' },
              LicenseUrl: { value: '' }
            }
          }
        ]
      }
    ]
  }
}
const search = {
  uso: 'video',
  queries: ['cafetería interior', 'coffee shop interior'],
  requirements: { subject: 'Cafetería', usage: 'Video' }
}
const evaluation = { mode: 'visual', observed: 'Mesas y barra', meets: ['cafetería'], doubts: '' }
const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text
let dir: string, root: string, registry: FreeImageRegistry, photos: Photos, chat: ChatPhotos, video: Video
const renderDocument = vi.fn()
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'lzx-video-photos-')))
  root = join(dir, 'project')
  await mkdir(root)
  registry = new FreeImageRegistry(join(dir, 'registry'))
  photos = new Photos({
    photoRegistry: registry,
    freeImages: () =>
      new FreeImagesService({
        fetch: async (url) => (String(url).includes('/w/api.php') ? Response.json(raw) : new Response(new Uint8Array(bytes))),
        processor: {
          normalize: async (_bytes, edge) => jpeg(Math.min(1200, edge), Math.round(800 * Math.min(1, edge / 1200))),
          sheet: async () => bytes
        }
      }),
    render: renderDocument,
    audit: () => undefined
  })
  chat = new ChatPhotos(photos, join(dir, 'chat-photos'))
  video = new Video({
    privateDir: join(dir, 'render'),
    pieces: () => ({ state: 'ready', paths: { chrome: '/chrome', ffmpeg: '/ffmpeg', ffprobe: '/ffprobe', hyperframes: '/hyperframes' } }),
    node: () => '/node',
    consent: async () => true,
    install: async () => {},
    pollMs: 5,
    photo: async (scope, session, isChat, origin) =>
      resolveVideoPhoto(new FreeImageRegistry(join(dir, 'registry')), isChat && session ? await chat.rootFor(session) : scope, origin),
    render: async (job: RenderJob) => {
      expect(await readFile(join(dirname(job.composition), 'assets/foto.jpg'))).toEqual(bytes)
      const images = job.times.map((_, i) => join(job.work, `control-${i + 1}.png`))
      const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex')
      await Promise.all(images.map((image) => writeFile(image, png)))
      if (!job.seconds) return { images }
      const mp4 = join(job.work, 'video.mp4')
      await writeFile(mp4, 'MP4 del doble de worker')
      return { images, mp4, duration: job.seconds }
    }
  })
})
afterEach(async () => {
  await video.stop()
  await chat.stop()
  await photos.stop()
  await rm(dir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('fotos de cualquier licencia para video', () => {
  it.each(['Chat', 'Code', 'Tareas'])('%s: buscar/ver/usar -> cuadros/render; sin créditos ni URL en composición', async (mode) => {
    const binding: DocumentsBinding = mode === 'Code' ? { folder: CODE_BINDING_FOLDER, code: { roots: () => [root] } } : { folder: root }
    const invoke = (name: string, args: Record<string, unknown>) =>
      mode === 'Chat' ? chat.invoke(name, args) : photos.invoke(binding, name, { ...args, ...(mode === 'Code' ? { carpeta: root } : {}) })
    const found = await invoke('imagenes_buscar', search)
    expect(found.isError, text(found)).not.toBe(true)
    const id = JSON.parse(text(found)).candidates[0].id
    expect((await invoke('imagenes_ver', { ids: [id] })).isError).not.toBe(true)
    expect((await invoke('imagenes_usar', { id, evaluation })).isError).toBe(true)
    const saved = await invoke('imagenes_usar', { id, uso: 'video', evaluation })
    expect(saved.isError, text(saved)).not.toBe(true)
    const photo = JSON.parse(text(saved))
    expect(photo.uso).toBe('video')
    const scope = mode === 'Chat' ? await chat.rootFor('ses_video') : root
    const stored = await registry.findId(scope, id, 'video')
    expect(stored?.asset.provenance).toMatchObject({
      license: 'All rights reserved',
      licenseUrl: '',
      uso: 'video',
      status: 'licencia-registrada'
    })
    const restored = await invoke('imagenes_usar', { id, uso: 'video' })
    expect(restored.isError, text(restored)).not.toBe(true)
    let vb: VideoBinding = { folder: root }
    let composition: Record<string, unknown> = { composicion: 'promo/index.html' }
    if (mode === 'Chat') {
      vb = { folder: '<chat>', chat: { directory: join(dir, 'chat-video'), activeSession: async () => 'ses_video' } }
      composition = { archivos: { 'index.html': '<img src="assets/foto.jpg">' } }
    } else {
      await mkdir(join(root, 'promo'))
      await writeFile(join(root, 'promo/index.html'), '<img src="assets/foto.jpg">')
      if (mode === 'Code') vb = { folder: CODE_BINDING_FOLDER, code: { roots: () => [root] } }
    }
    const options = { formato: 'vertical', ...(mode === 'Code' ? { carpeta: root } : {}) }
    const frames = await video.invoke(vb, 'cuadros', {
      ...options,
      ...composition,
      segundos: [1],
      fotos: [{ origen: photo.source ?? `imagen:${id}`, destino: 'assets/foto.jpg' }]
    })
    expect(frames.isError, text(frames)).not.toBe(true)
    const path = JSON.parse(text(frames)).composicion
    const rendered = await video.invoke(vb, 'render', {
      ...options,
      composicion: path,
      duracion: 3,
      fps: 30,
      nombre: 'Video',
      fotos: [{ origen: mode === 'Chat' ? photo.source : photo.path, destino: 'assets/foto.jpg' }]
    })
    expect(rendered.isError, text(rendered)).not.toBe(true)
    expect(text(rendered)).not.toMatch(/All rights reserved|credit|license/)
    expect(await registry.findId(scope, id)).toBeNull()
    const doc = await photos.invoke({ folder: scope }, 'crear', {
      tipo: 'docx',
      nombre: 'Documento',
      spec: { blocks: [{ type: 'image', path: stored!.rel }] }
    })
    expect(doc.isError, text(doc)).toBe(true)
    expect(text(doc)).toContain('solo para video')
    await copyFile(join(scope, stored!.rel), join(scope, 'renombrada.jpg'))
    const copied = await photos.invoke({ folder: scope }, 'crear', {
      tipo: 'docx',
      spec: { blocks: [{ type: 'image', path: 'renombrada.jpg' }] }
    })
    expect(copied.isError, text(copied)).toBe(true)
    expect(text(copied)).toContain('solo para video')
    const byId = await photos.invoke({ folder: scope }, 'crear', { tipo: 'docx', spec: { blocks: [{ type: 'image', id }] } })
    expect(byId.isError).toBe(true)
    const html = await photos.resolveHtmlPhotos('<div class="slide"><img src="imagen:' + id + '"></div>', { root: scope }).catch((e) => e)
    expect(html).toBeInstanceOf(Error)
    expect(renderDocument).not.toHaveBeenCalled()
  })
})
