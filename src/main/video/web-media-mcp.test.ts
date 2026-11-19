import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { VideoMcpServer, type VideoBinding } from './mcp-server'
import { downloadVideoMedia } from './web-media'
import type { RenderJob } from './render-process'

class Server extends VideoMcpServer {
  invoke(binding: VideoBinding, name: string, args: Record<string, unknown>) {
    return this.callTool(binding, name, args)
  }
}
const png = Buffer.from('89504e470d0a1a0a0000000d494844520000010e000001e00806000000', 'hex')
const mp3 = Buffer.from('fffb906400000000', 'hex')
const dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

it.each(['Chat', 'Code', 'Overdrive'] as const)('HTTPS se descarga en main y persiste antes del worker sin red (%s)', async (mode) => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'lzx-web-media-mcp-')))
  dirs.push(dir)
  const root = join(dir, 'project')
  await mkdir(join(root, 'promo'), { recursive: true })
  await writeFile(join(root, 'promo/index.html'), '<html>video</html>')
  const media = vi.fn(async (origin: string, kind: 'photo' | 'audio', signal: AbortSignal) =>
    downloadVideoMedia(origin, kind, signal, {
      resolve: async () => [{ address: '8.8.8.8', family: 4 }],
      request: async () => ({
        status: 200,
        cancel() {},
        body: (async function* () {
          yield kind === 'photo' ? png : mp3
        })()
      })
    })
  )
  const render = vi.fn(async (job: RenderJob) => {
    expect(await readFile(join(dirname(job.composition), 'assets/fotos/foto.png'))).toEqual(png)
    expect(job.audio).toHaveLength(1)
    expect(await readFile(job.audio![0]!.file)).toEqual(mp3)
    const images = await Promise.all(
      job.times.map(async (_, i) => {
        const path = join(job.work, `control-${i + 1}.png`)
        await writeFile(path, png)
        return path
      })
    )
    const mp4 = job.seconds ? join(job.work, 'video.mp4') : undefined
    if (mp4) await writeFile(mp4, 'fake trusted output')
    return { images, mp4, duration: job.seconds, audio: job.seconds ? { codec: 'aac', duration: job.seconds } : undefined }
  })
  const server = new Server({
    privateDir: join(dir, 'private'),
    download: media,
    render,
    pieces: () => ({ state: 'ready', paths: { chrome: '/chrome', ffmpeg: '/ffmpeg', ffprobe: '/ffprobe', hyperframes: '/hf' } }),
    node: () => '/node',
    consent: async () => true,
    install: async () => {}
  })
  const binding: VideoBinding =
    mode === 'Chat'
      ? { folder: '<chat>', chat: { directory: join(dir, 'chat'), activeSession: async () => 'ses_web' } }
      : mode === 'Code'
        ? { folder: '<code>', code: { roots: () => [root] } }
        : { folder: root, session: async () => 'ses_web', toAgentPath: (p) => `/agent/${p.slice(root.length + 1)}` }
  const photo = { origen: 'https://images.example.org/photo?ref=' + 'a'.repeat(500), destino: 'assets/fotos/foto.png' }
  const audio = [{ origen: 'https://audio.example.org/song', desde: 2, hasta: 17, fundidoEntrada: 0.4, fundidoSalida: 1.5 }]
  const common = { formato: 'vertical', ...(mode === 'Code' ? { carpeta: root } : {}) }
  try {
    const preview = await server.invoke(binding, 'cuadros', {
      ...common,
      ...(mode === 'Chat' ? { html: '<html>video</html>' } : { composicion: 'promo/index.html' }),
      segundos: [0, 6, 14],
      fotos: [photo],
      audio
    })
    expect(preview.isError, JSON.stringify(preview)).toBeUndefined()
    const result = JSON.parse((preview.content[0] as { text: string }).text)
    expect(result.fuentes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origen: photo.origen, tipo: 'photo' }),
        expect.objectContaining({ origen: audio[0].origen, tipo: 'audio' })
      ])
    )
    const output = await server.invoke(binding, 'render', {
      ...common,
      composicion: result.composicion,
      duracion: 15,
      fps: 30,
      nombre: 'Promo',
      audio
    })
    expect(output.isError, JSON.stringify(output)).toBeUndefined()
    expect(JSON.parse((output.content[0] as { text: string }).text).audio.codec).toBe('aac')
    // Las revisiones y el render repetido no vuelven a bajar el mismo MP3.
    expect(media).toHaveBeenCalledTimes(2)
    media.mockRejectedValueOnce(new DOMException('red lenta en el segundo intento', 'TimeoutError'))
    const repeated = await server.invoke(binding, 'render', {
      ...common,
      composicion: result.composicion,
      duracion: 15,
      fps: 30,
      nombre: 'Promo-alegre',
      audio
    })
    expect(repeated.isError, JSON.stringify(repeated)).toBeUndefined()
    expect(JSON.parse((repeated.content[0] as { text: string }).text).ruta).toBe(
      JSON.parse((output.content[0] as { text: string }).text).ruta
    )
    expect(media).toHaveBeenCalledTimes(2)
    expect(await readdir(join(dir, 'private'))).toEqual([])
    const actualRoot = mode === 'Chat' ? join(dir, 'chat/videos', (await readdir(join(dir, 'chat/videos')))[0]!) : root
    const assets = join(actualRoot, dirname(result.composicion), 'assets')
    const provenance = await readdir(join(assets, 'origenes'))
    expect(provenance).toHaveLength(2)
    const source = await Promise.all(provenance.map(async (name) => JSON.parse(await readFile(join(assets, 'origenes', name), 'utf8'))))
    expect(source.map((s) => s.origen)).toEqual(expect.arrayContaining([photo.origen, audio[0].origen]))
    expect(await readdir(join(assets, 'audio'))).toHaveLength(1)
  } finally {
    await server.stop()
  }
})
