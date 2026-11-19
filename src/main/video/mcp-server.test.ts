import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink, link, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import { VideoMcpServer, type VideoBinding, type VideoRenderDeps } from './mcp-server'
import { MAX_ASSET_BYTES, MAX_COMPOSITION_FILES } from './composition'
import type { RenderJob } from './render-process'
import { chatFilesInfo, assertNativeViewable } from '../files/chat-files'
import { macOnly, posixOnly } from '../../test/platform'

class Server extends VideoMcpServer {
  invoke(binding: VideoBinding, name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    return this.callTool(binding, name, args, signal)
  }
  tools() {
    return this.listTools()
  }
}
let dir: string, root: string, binding: VideoBinding, deps: VideoRenderDeps, server: Server
const png = Buffer.from('89504e470d0a1a0a0000000d494844520000010e000001e00806000000', 'hex')
const args = { composicion: 'promo/index.html', formato: 'vertical', segundos: [1, 5, 10] }
const result = async (job: RenderJob) => {
  const images = await Promise.all(
    job.times.map(async (_, i) => {
      const path = join(job.work, `control-${i + 1}.png`)
      await writeFile(path, png)
      return path
    })
  )
  const mp4 = job.seconds ? join(job.work, 'video.mp4') : undefined
  if (mp4) await writeFile(mp4, 'fake MP4 from trusted process double')
  return { images, mp4, duration: job.seconds }
}
beforeEach(async () => {
  dir = await realpath(await mkdtemp(join(tmpdir(), 'lzx-video-mcp-test-')))
  root = join(dir, 'project')
  await mkdir(join(root, 'promo'), { recursive: true })
  await writeFile(join(root, 'promo/index.html'), '<html>composición</html>')
  binding = { folder: root }
  deps = {
    privateDir: join(dir, 'private'),
    pieces: () => ({ state: 'ready', paths: { chrome: '/chrome', ffmpeg: '/ffmpeg', ffprobe: '/ffprobe', hyperframes: '/hyperframes' } }),
    node: () => '/app-node',
    consent: vi.fn(async () => true),
    install: vi.fn(async () => {}),
    render: vi.fn(result),
    pollMs: 5
  }
  server = new Server(deps)
})
afterEach(async () => {
  await server.stop()
  await rm(dir, { recursive: true, force: true })
})
const text = (r: Awaited<ReturnType<Server['invoke']>>) =>
  r.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('')

describe('video: atadura, copia y resultados', () => {
  it.each([
    ['vertical', 1080, 1920],
    ['cuadrado', 1080, 1080],
    ['horizontal', 1920, 1080]
  ])('formato %s, PNG chicos y MP4 verificado por el worker', async (formato, width, height) => {
    const preview = await server.invoke(binding, 'cuadros', { ...args, formato })
    expect(preview.isError).toBeUndefined()
    expect(preview.content.filter((i) => i.type === 'image')).toHaveLength(3)
    expect(deps.render).toHaveBeenLastCalledWith(expect.objectContaining({ width, height, node: '/app-node' }), expect.any(AbortSignal))
    const video = await server.invoke(binding, 'render', { composicion: args.composicion, formato, duracion: 15, fps: 30, nombre: 'Promo' })
    expect(JSON.parse(text(video))).toMatchObject({ duracion: 15, ruta: join(root, 'Promo.mp4'), bytes: 36 })
    expect(await readdir(join(dir, 'private'))).toEqual([])
    expect(await readdir(join(root, 'promo'))).toEqual(['index.html'])
  })
  it('los cuadros quedan en trabajo, con nombres estables incluso al recrear la atadura', async () => {
    const first = JSON.parse(text(await server.invoke(binding, 'cuadros', args)))
    const second = JSON.parse(text(await server.invoke({ folder: root }, 'cuadros', args)))
    expect(first.cuadros).toEqual(second.cuadros)
    expect(first.cuadros[0]).toMatch(/\/\.lazunox\/trabajo\/video\/[a-f0-9]{16}\/cuadro-1.png$/)
    expect((await readdir(root)).sort()).toEqual(['.lazunox', 'promo'])
  })
  it.skipIf(!posixOnly)('rechaza enlaces en la carpeta de cuadros y no escribe fuera de la raíz concedida', async () => {
    const first = JSON.parse(text(await server.invoke(binding, 'cuadros', args)))
    const frames = first.cuadros[0].slice(0, first.cuadros[0].lastIndexOf('/'))
    const outside = join(dir, 'fuera')
    await mkdir(outside)
    await rm(frames, { recursive: true })
    await symlink(outside, frames)
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBe(true)
    expect(await readdir(outside)).toEqual([])
  })
  it('reemplaza MP4 propio intacto de la misma composición entre pedidos y protege ediciones', async () => {
    let request = 'msg_1'
    binding.session = async () => 'ses_1'
    binding.request = async () => request
    const render = { composicion: args.composicion, formato: 'vertical', duracion: 15, fps: 30, nombre: 'Promo' }
    const a = JSON.parse(text(await server.invoke(binding, 'render', render)))
    const b = JSON.parse(text(await server.invoke(binding, 'render', render)))
    expect(b.ruta).toBe(a.ruta)
    request = 'msg_2'
    const c = JSON.parse(text(await server.invoke(binding, 'render', render)))
    expect(c.ruta).toBe(a.ruta)
    const d = JSON.parse(text(await server.invoke(binding, 'render', render)))
    expect(d.ruta).toBe(c.ruta)
    await writeFile(c.ruta, 'edición de la persona')
    const e = JSON.parse(text(await server.invoke(binding, 'render', render)))
    expect(e.ruta).toBe(join(root, 'Promo (2).mp4'))
    expect(await readFile(c.ruta, 'utf8')).toBe('edición de la persona')
    binding.request = async () => null
    const f = JSON.parse(text(await server.invoke(binding, 'render', render)))
    expect(f.ruta).toBe(e.ruta)
  })
  it('no reemplaza salidas de otra composición o sesión aunque se repita el nombre', async () => {
    let session = 'ses_1'
    binding.session = async () => session
    binding.request = async () => 'msg_1'
    const render = { composicion: args.composicion, formato: 'vertical', duracion: 15, fps: 30, nombre: 'Promo' }
    const first = JSON.parse(text(await server.invoke(binding, 'render', render)))
    await mkdir(join(root, 'otra'))
    await writeFile(join(root, 'otra/index.html'), '<html>otra composición</html>')
    const other = JSON.parse(text(await server.invoke(binding, 'render', { ...render, composicion: 'otra/index.html' })))
    expect(other.ruta).toBe(join(root, 'Promo (2).mp4'))
    session = 'ses_2'
    const next = JSON.parse(text(await server.invoke(binding, 'render', render)))
    expect(next.ruta).toBe(join(root, 'Promo (3).mp4'))
    expect(first.ruta).toBe(join(root, 'Promo.mp4'))
  })
  it.skipIf(!posixOnly)('no reemplaza un MP4 cambiado por enlace simbólico o duro', async () => {
    binding.session = async () => 'ses_1'
    binding.request = async () => 'msg_1'
    const render = { composicion: args.composicion, formato: 'vertical', duracion: 15, fps: 30, nombre: 'Promo' }
    const a = JSON.parse(text(await server.invoke(binding, 'render', render)))
    const external = join(dir, 'persona.mp4')
    await writeFile(external, 'original')
    await rm(a.ruta)
    await symlink(external, a.ruta)
    const b = JSON.parse(text(await server.invoke(binding, 'render', render)))
    expect(b.ruta).toBe(join(root, 'Promo (2).mp4'))
    await link(b.ruta, join(dir, 'hard.mp4'))
    const c = JSON.parse(text(await server.invoke(binding, 'render', render)))
    expect(c.ruta).toBe(join(root, 'Promo (3).mp4'))
    expect(await readFile(external, 'utf8')).toBe('original')
    expect(await readFile(join(dir, 'hard.mp4'), 'utf8')).toBe('fake MP4 from trusted process double')
  })
  it('no publica si cambia el pedido durante el render', async () => {
    let request = 'msg_1'
    binding.session = async () => 'ses_1'
    binding.request = async () => request
    deps.render = async (job) => {
      request = 'msg_2'
      return result(job)
    }
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('pedido cambió')
    expect((await readdir(root)).sort()).toEqual(['promo'])
  })
  it.each(['../index.html', '/tmp/index.html', 'C:\\index.html', 'promo/../../index.html', 'promo/test.html', 'promo/index.html\0'])(
    'rechaza ruta %s antes de instalar o lanzar',
    async (composicion) => {
      const out = await server.invoke(binding, 'cuadros', { ...args, composicion })
      expect(out.isError).toBe(true)
      expect(deps.render).not.toHaveBeenCalled()
      expect(deps.consent).not.toHaveBeenCalled()
    }
  )
  it.skipIf(!posixOnly)('rechaza enlaces de carpeta, archivo y recurso, incluso hacia dentro', async () => {
    for (const [target, path] of [
      [join(root, 'promo'), join(root, 'alias')],
      [join(root, 'promo/index.html'), join(root, 'promo/ref.html')]
    ]) {
      await symlink(target, path)
    }
    expect((await server.invoke(binding, 'cuadros', { ...args, composicion: 'alias/index.html' })).isError).toBe(true)
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBe(true)
    expect(deps.render).not.toHaveBeenCalled()
  })
  it('rechaza un enlace duro', async () => {
    await link(join(root, 'promo/index.html'), join(root, 'promo/copia.html'))
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBe(true)
    expect(deps.render).not.toHaveBeenCalled()
  })
  it('aplica topes de archivos, tamaño y tipos', async () => {
    await writeFile(join(root, 'promo/big.png'), Buffer.alloc(MAX_ASSET_BYTES + 1))
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('tamaño')
    await rm(join(root, 'promo/big.png'))
    await Promise.all(Array.from({ length: MAX_COMPOSITION_FILES }, (_, i) => writeFile(join(root, `promo/${i}.css`), '')))
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('256')
    expect(deps.render).not.toHaveBeenCalled()
  })
  it('no publica un archivo arbitrario ni un resultado incompleto del proceso', async () => {
    deps.render = vi.fn(async () => ({ images: ['/etc/passwd'] }))
    expect((await server.invoke(binding, 'cuadros', { ...args, segundos: [1] })).isError).toBe(true)
    deps.render = vi.fn(async () => ({ images: [] }))
    expect(
      (await server.invoke(binding, 'render', { composicion: args.composicion, formato: 'vertical', duracion: 15, fps: 30, nombre: 'x' }))
        .isError
    ).toBe(true)
    expect((await readdir(root)).filter((f) => /\.(png|mp4)$/.test(f))).toEqual([])
  })
  it('devuelve las rutas de WSL solo en el resultado', async () => {
    binding.toAgentPath = (p) => '/win/c/project/' + p.slice(root.length + 1)
    const out = await server.invoke(binding, 'cuadros', args)
    expect(JSON.parse(text(out)).cuadros[0]).toMatch(/^\/win\/c\/project\/\.lazunox\/trabajo\/video\/[a-f0-9]{16}\/cuadro-1.png$/)
    expect(deps.render).toHaveBeenCalledWith(
      expect.objectContaining({ composition: expect.stringContaining('/private/render-') }),
      expect.any(AbortSignal)
    )
  })
})
describe('video: validación y consentimiento', () => {
  it.each([
    { formato: 'bad' },
    { segundos: [] },
    { segundos: [NaN] },
    { segundos: [-1] },
    { segundos: [120] },
    { segundos: Array(7).fill(1) },
    { sessionId: 'ses_other' },
    { carpeta: '/outside' }
  ])('rechaza argumentos %o', async (extra) => {
    expect((await server.invoke(binding, 'cuadros', { ...args, ...extra })).isError).toBe(true)
    expect(deps.render).not.toHaveBeenCalled()
  })
  it.each([{ duracion: 121 }, { duracion: 0 }, { duracion: NaN }, { duracion: 0.01 }, { fps: 60 }, { nombre: '' }, { nombre: 'CON' }])(
    'rechaza render %o',
    async (extra) => {
      const out = await server.invoke(binding, 'render', {
        composicion: args.composicion,
        formato: 'vertical',
        duracion: 15,
        fps: 30,
        nombre: 'promo',
        ...extra
      })
      expect(out.isError).toBe(true)
    }
  )
  it('Ahora no no descarga; Instalar recibe los bytes y continúa tras verificar piezas', async () => {
    let installed = false
    deps.pieces = () =>
      installed
        ? { state: 'ready', paths: { chrome: '/chrome', ffmpeg: '/ffmpeg', ffprobe: '/ffprobe', hyperframes: '/hyperframes' } }
        : { state: 'missing', missingBytes: 245874652 }
    deps.consent = vi.fn(async () => false)
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('no se recibió autorización')
    expect(deps.install).not.toHaveBeenCalled()
    deps.consent = vi.fn(async () => true)
    deps.install = vi.fn(async () => {
      installed = true
    })
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBeUndefined()
    expect(deps.consent).toHaveBeenCalledWith(245874652, expect.any(AbortSignal))
    expect(deps.install).toHaveBeenCalledOnce()
  })
  it('no continúa si instalar falla o siguen faltando piezas; unsupported no pregunta', async () => {
    deps.pieces = () => ({ state: 'missing', missingBytes: 100 })
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBe(true)
    deps.install = vi.fn(async () => {
      throw Error('descarga cancelada')
    })
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('descarga cancelada')
    deps.pieces = () => ({ state: 'unsupported' })
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('no está disponible')
    expect(deps.consent).toHaveBeenCalledTimes(2)
    expect(deps.render).not.toHaveBeenCalled()
  })
})
describe('video: límites y cancelación', () => {
  const blockedRender = () =>
    vi.fn(
      (_job: RenderJob, signal: AbortSignal) =>
        new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(Error('cancelled')), { once: true }))
    )
  it('una llamada por atadura y dos globales; abortar libera ambos turnos', async () => {
    deps.render = blockedRender()
    const a = new AbortController(),
      b = new AbortController()
    const p1 = server.invoke(binding, 'cuadros', args, a.signal)
    await vi.waitFor(() => expect(deps.render).toHaveBeenCalledTimes(1))
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('atadura')
    const p2 = server.invoke({ folder: root }, 'cuadros', args, b.signal)
    await vi.waitFor(() => expect(deps.render).toHaveBeenCalledTimes(2))
    expect(text(await server.invoke({ folder: root }, 'cuadros', args))).toContain('dos operaciones')
    a.abort()
    b.abort()
    expect((await p1).isError).toBe(true)
    expect((await p2).isError).toBe(true)
    deps.render = vi.fn(result)
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBeUndefined()
  })
  it('revocar token y detener servidor cancelan el proceso', async () => {
    deps.render = blockedRender()
    const { token } = await server.clientFor(binding)
    const p = server.invoke(binding, 'cuadros', args)
    await vi.waitFor(() => expect(deps.render).toHaveBeenCalled())
    server.revokeToken(token)
    expect(text(await p)).toContain('canceló')
    const p2 = server.invoke(binding, 'cuadros', args)
    await server.clientFor(binding)
    await vi.waitFor(() => expect(deps.render).toHaveBeenCalledTimes(2))
    await server.stop()
    expect((await p2).isError).toBe(true)
  })
  it('el tiempo máximo y una sesión que se detiene cancelan antes de publicar', async () => {
    deps.timeoutMs = 15
    deps.render = blockedRender()
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('superó el tiempo máximo')
    deps.timeoutMs = 1000
    let active = 'ses_123'
    binding.session = async () => active
    const p = server.invoke(binding, 'cuadros', args)
    await vi.waitFor(() => expect(deps.render).toHaveBeenCalledTimes(2))
    active = ''
    expect((await p).isError).toBe(true)
    expect(await readdir(join(dir, 'private'))).toEqual([])
  })
  it('cancelar mientras pregunta no instala', async () => {
    deps.pieces = () => ({ state: 'missing', missingBytes: 100 })
    deps.consent = vi.fn(
      (_b, signal) => new Promise<boolean>((done) => signal.addEventListener('abort', () => done(false), { once: true }))
    )
    const ac = new AbortController(),
      p = server.invoke(binding, 'cuadros', args, ac.signal)
    await vi.waitFor(() => expect(deps.consent).toHaveBeenCalled())
    ac.abort()
    expect((await p).isError).toBe(true)
    expect(deps.install).not.toHaveBeenCalled()
  })
})
describe('video: Code, Chat y transporte MCP', () => {
  it('Code consulta los proyectos abiertos en cada llamada', async () => {
    let roots = [root]
    binding = { folder: '<code>', code: { roots: () => roots } }
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBe(true)
    expect((await server.invoke(binding, 'cuadros', { ...args, carpeta: root })).isError).toBeUndefined()
    roots = []
    expect((await server.invoke(binding, 'cuadros', { ...args, carpeta: root })).isError).toBe(true)
  })
  it('Chat guarda html en una carpeta por conversación; rechaza sesión ambigua y html en Code', async () => {
    binding = { folder: '<sidecar>', chat: { directory: join(dir, 'chat'), activeSession: async () => 'ses_abc' } }
    const out = await server.invoke(binding, 'cuadros', { formato: 'vertical', segundos: [1], html: '<html>promo</html>' })
    expect(out.isError).toBeUndefined()
    expect(JSON.parse(text(out)).composicion).toMatch(/^\.lazunox\/trabajo\/video\/composicion-.+\/index.html$/)
    expect(JSON.parse(text(out)).cuadros[0]).toContain(join(dir, 'chat', 'videos'))
    expect(
      (await server.invoke(binding, 'cuadros', { formato: 'vertical', segundos: [1], html: 'x'.repeat(512 * 1024 + 1) })).isError
    ).toBe(true)
    binding.chat!.activeSession = async () => null
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBe(true)
    expect((await server.invoke({ folder: root }, 'cuadros', { ...args, html: '<html>' })).isError).toBe(true)
  })
  it('Chat devuelve MP4 absoluto dentro del workspace: información y autorización del visor coinciden', async () => {
    const chat = join(dir, 'chat-workspace')
    binding = { folder: '<sidecar>', chat: { directory: chat, activeSession: async () => 'ses_chat' } }
    const preview = JSON.parse(
      text(await server.invoke(binding, 'cuadros', { formato: 'vertical', segundos: [1], html: '<html>promo</html>' }))
    )
    const out = await server.invoke(binding, 'render', {
      composicion: preview.composicion,
      formato: 'vertical',
      duracion: 15,
      fps: 30,
      nombre: 'Promo'
    })
    expect(out.isError).toBeUndefined()
    const video = JSON.parse(text(out))
    expect(video.ruta).toMatch(new RegExp('/chat-workspace/videos/[a-f0-9]{64}/Promo.mp4$'))
    expect(chatFilesInfo([chat], [video.ruta])).toEqual([expect.objectContaining({ path: video.ruta, canView: true, canOpen: true })])
    expect(assertNativeViewable([chat], video.ruta)).toBe(video.ruta)
    expect(chatFilesInfo([chat], [join(dir, 'project/Promo.mp4')])).toEqual([])
  })
  it('MCP autentica token, rechaza Origin y revoca ataduras anteriores', async () => {
    const { token, port } = await server.clientFor(binding)
    const url = `http://127.0.0.1:${port}/mcp`
    const rpc = { jsonrpc: '2.0', id: 1, method: 'tools/list' }
    expect((await fetch(url, { method: 'POST', body: JSON.stringify(rpc) })).status).toBe(401)
    expect(
      (
        await fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, Origin: 'http://evil.invalid' },
          body: JSON.stringify(rpc)
        })
      ).status
    ).toBe(403)
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...rpc, method: 'tools/call', params: { name: 'cuadros', arguments: args } })
    })
    expect((await response.json()).result.content.filter((i: { type: string }) => i.type === 'image')).toHaveLength(3)
    await server.clientFor({ folder: root })
    expect((await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(rpc) })).status).toBe(
      401
    )
    expect(server.tools()).toHaveLength(3)
  })
  it.skipIf(!macOnly)('copia sin seguir enlaces intermedios con O_NOFOLLOW_ANY', async () => {
    // El caso de enlace en un padre ya se rechaza en el recorrido; el flag cierra además la carrera en open.
    await symlink(join(root, 'promo'), join(root, 'padre'))
    expect((await server.invoke(binding, 'cuadros', { ...args, composicion: 'padre/index.html' })).isError).toBe(true)
  })
})

it('apagar video cierra también sockets TCP sin cabeceras y espera su limpieza', async () => {
  const { port } = await server.clientFor(binding)
  const socket = createConnection(port, '127.0.0.1')
  await once(socket, 'connect')
  socket.on('error', () => undefined) // cerrar una conexión sin HTTP puede terminar con ECONNRESET
  const closed = new Promise<void>((done) => socket.once('close', () => done()))
  await server.stop()
  await closed
  expect(socket.destroyed).toBe(true)
})

it('ambas descripciones enseñan el contrato obligatorio y qué hacer con los avisos', () => {
  for (const tool of (server.tools() as { name: string; description: string }[]).filter((tool) => tool.name !== 'musica_buscar')) {
    for (const key of [
      'data-composition-id',
      'data-width',
      'data-height',
      'data-duration',
      'window.__timelines.main',
      'GSAP local',
      'avisos'
    ])
      expect(tool.description).toContain(key)
  }
})
it('devuelve los avisos, su segundo, cobertura y peso de imágenes sin bloquear la salida', async () => {
  deps.render = async (job) => ({
    ...(await result(job)),
    avisos: ['5 s: el texto "HORARIO" queda tapado por otro elemento'],
    cobertura: [{ segundo: 5, proporcion: 0.3 }]
  })
  const response = await server.invoke(binding, 'cuadros', args)
  expect(response.isError).toBeUndefined()
  expect(JSON.parse(text(response))).toMatchObject({
    avisos: [expect.stringContaining('5 s:')],
    cobertura: [{ segundo: 5, proporcion: 0.3 }],
    imagenesBytes: 3 * 4 * Math.ceil(png.length / 3)
  })
})
it('el error de formato llega al modelo con esqueleto adaptado', async () => {
  const { VideoRenderError } = await import('./render-errors')
  deps.render = async () => {
    throw new VideoRenderError('formato_no_coincide', { width: 1920, height: 1080 })
  }
  const response = await server.invoke(binding, 'cuadros', args)
  expect(response.isError).toBe(true)
  expect(text(response)).toContain('1920×1080, pero pediste vertical (1080×1920)')
  expect(text(response)).toContain('data-composition-id="main"')
})

it('Chat crea escenas con archivos y permite actualizar solo un archivo conservando el resto', async () => {
  binding = { folder: '<chat>', chat: { directory: join(dir, 'chat'), activeSession: async () => 'ses_files' } }
  const preview = JSON.parse(
    text(
      await server.invoke(binding, 'cuadros', {
        formato: 'vertical',
        segundos: [1],
        archivos: {
          'index.html': '<html>root</html>',
          'compositions/uno.html': '<template>antes</template>',
          'assets/style.css': 'h1{color:red}'
        }
      })
    )
  )
  expect(preview.composicion).toContain('/index.html')
  const out = await server.invoke(binding, 'cuadros', {
    composicion: preview.composicion,
    formato: 'vertical',
    segundos: [1],
    archivos: { 'compositions/uno.html': '<template>después</template>' }
  })
  expect(out.isError).toBeUndefined()
  const render = vi.mocked(deps.render)
  expect(render).toHaveBeenCalledTimes(2)
  const actual = JSON.parse(text(out)).composicion
  const folder = join(dir, 'chat/videos', createHashForTest('ses_files'), actual, '..')
  expect(await readFile(join(folder, 'index.html'), 'utf8')).toBe('<html>root</html>')
  expect(await readFile(join(folder, 'compositions/uno.html'), 'utf8')).toContain('después')
  expect((await server.invoke(binding, 'cuadros', { formato: 'vertical', segundos: [1], archivos: { '../x.html': 'x' } })).isError).toBe(
    true
  )
  expect((await server.invoke({ folder: root }, 'cuadros', { ...args, archivos: { 'index.html': 'x' } })).isError).toBe(true)
})
function createHashForTest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
it('fotos por ruta, id preparado o adjunto de Chat se copian a assets sin créditos; audio solo al temporal', async () => {
  await writeFile(join(root, 'foto.png'), png)
  const out = await server.invoke(binding, 'cuadros', { ...args, fotos: [{ origen: 'foto.png', destino: 'assets/foto.png' }] })
  expect(out.isError).toBeUndefined()
  expect(await readFile(join(root, 'promo/assets/foto.png'))).toEqual(png)
  expect(text(out)).not.toContain('credit')
  deps.photo = async (_root, _session, _chat, origin) => (origin === 'imagen:id' ? png : null)
  expect(
    (await server.invoke(binding, 'cuadros', { ...args, fotos: [{ origen: 'imagen:id', destino: 'assets/id.png' }] })).isError
  ).toBeUndefined()
  binding = {
    folder: '<chat>',
    chat: { directory: join(dir, 'chat'), activeSession: async () => 'ses_media' },
    media: async (_id, origin) => (origin === 'foto-adjunta' ? png : null)
  }
  const preview = await server.invoke(binding, 'cuadros', {
    formato: 'vertical',
    segundos: [1],
    archivos: { 'index.html': '<html/>' },
    fotos: [{ origen: 'foto-adjunta', destino: 'assets/persona.png' }]
  })
  expect(preview.isError).toBeUndefined()
  await writeFile(join(root, 'persona.wav'), 'se comprueba con ffprobe dentro del worker')
  const render = await server.invoke({ folder: root }, 'render', {
    composicion: 'promo/index.html',
    formato: 'vertical',
    duracion: 9,
    fps: 30,
    nombre: 'Audio',
    audio: [{ origen: 'persona.wav', desde: 1, hasta: 5, fundidoSalida: 0.4 }]
  })
  expect(render.isError).toBeUndefined()
  expect(vi.mocked(deps.render).mock.lastCall![0].audio?.[0]).toMatchObject({ desde: 1, hasta: 5, fundidoSalida: 0.4 })
  expect(await readdir(join(root, 'promo'))).not.toContain('audio-0')
})
it('publica hoja de contactos como imagen y rechaza una ruta de hoja ajena al worker', async () => {
  deps.render = async (job, signal) => {
    const output = await result(job)
    signal.throwIfAborted()
    const contactSheet = join(job.work, 'contactos.png')
    await writeFile(contactSheet, png)
    return { ...output, contactSheet }
  }
  const out = await server.invoke(binding, 'cuadros', args)
  expect(out.content.filter((c) => c.type === 'image')).toHaveLength(4)
  expect(JSON.parse(text(out)).hojaContactos).toMatch(/contactos.png$/)
  deps.render = async (job) => ({ ...(await result(job)), contactSheet: '/fuera.png' })
  expect((await server.invoke(binding, 'cuadros', args)).isError).toBe(true)
})
it('el transporte de video acepta archivos de Chat mayores de 1 MiB, con límites propios', async () => {
  const chatBinding = { folder: '<chat>', chat: { directory: join(dir, 'chat'), activeSession: async () => 'ses_body' } }
  const { port, token } = await server.clientFor(chatBinding)
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'cuadros',
        arguments: {
          formato: 'vertical',
          segundos: [1],
          archivos: { 'index.html': 'x'.repeat(400000), 'a.css': 'a'.repeat(400000), 'b.css': 'b'.repeat(400000) }
        }
      }
    })
  })
  expect(response.status).toBe(200)
  expect((await response.json()).result.isError).toBeUndefined()
})

it('la herramienta conserva el MP4 al cambiar nombre; nueva_version crea una salida aparte que se puede corregir', async () => {
  const render = { composicion: args.composicion, formato: 'vertical', duracion: 15, fps: 30, nombre: 'Original' }
  const first = JSON.parse(text(await server.invoke(binding, 'render', render)))
  const changed = await server.invoke(binding, 'render', { ...render, nombre: 'Original-alegre' })
  expect(changed.isError).toBeUndefined()
  expect(JSON.parse(text(changed)).ruta).toBe(first.ruta)
  const apart = JSON.parse(text(await server.invoke(binding, 'render', { ...render, nueva_version: true })))
  expect(apart.ruta).not.toBe(first.ruta)
  expect(JSON.parse(text(await server.invoke(binding, 'render', { ...render, nombre: 'Corrección' }))).ruta).toBe(apart.ruta)
  expect((await readdir(root)).filter((p) => p.endsWith('.mp4'))).toHaveLength(2)
  expect((await server.invoke(binding, 'render', { ...render, nueva_version: 'true' })).isError).toBe(true)
})
it('dos renders de Chat con mismo nombre y misma composición publican imágenes y reemplazan el mismo MP4', async () => {
  binding = { folder: '<chat>', chat: { directory: join(dir, 'chat'), activeSession: async () => 'ses_repeat' } }
  const preview = JSON.parse(text(await server.invoke(binding, 'cuadros', { formato: 'vertical', segundos: [0], html: '<html/>' })))
  const render = { composicion: preview.composicion, formato: 'vertical', duracion: 15, fps: 30, nombre: 'Promo' }
  const first = await server.invoke(binding, 'render', render)
  const second = await server.invoke(binding, 'render', render)
  expect(second.isError).toBeUndefined()
  expect(JSON.parse(text(first)).ruta).toBe(JSON.parse(text(second)).ruta)
  expect(second.content.filter((c) => c.type === 'image')).toHaveLength(3)
})
it('cancelar la espera de consentimiento informa cancelación, sin atribuir una respuesta a la persona', async () => {
  deps.pieces = () => ({ state: 'missing', missingBytes: 100 })
  const ac = new AbortController()
  deps.consent = async () => {
    ac.abort()
    return false
  }
  const out = text(await server.invoke(binding, 'cuadros', args, ac.signal))
  expect(out).toContain('canceló')
  expect(out).not.toContain('Ahora no')
  expect(deps.install).not.toHaveBeenCalled()
})
it('una revisión vuelve a ejecutar el worker con los bytes nuevos; no reutiliza movimiento', async () => {
  deps.render = vi.fn(async (job) => ({
    ...(await result(job)),
    movimiento: {
      porcentajeQuieto: (await readFile(job.composition, 'utf8')).includes('nuevo') ? 0 : 50,
      tramos: [],
      intervalo: 0.25,
      aviso: null
    }
  }))
  expect(JSON.parse(text(await server.invoke(binding, 'cuadros', args))).movimiento.porcentajeQuieto).toBe(50)
  await writeFile(join(root, 'promo/index.html'), '<html>nuevo</html>')
  expect(JSON.parse(text(await server.invoke(binding, 'cuadros', args))).movimiento.porcentajeQuieto).toBe(0)
  expect(deps.render).toHaveBeenCalledTimes(2)
})

it('la misma conversación conserva su salida al renovar la atadura del motor', async () => {
  const directory = join(dir, 'chat')
  binding = { folder: '<chat>', chat: { directory, activeSession: async () => 'ses_rebind' } }
  const preview = JSON.parse(text(await server.invoke(binding, 'cuadros', { formato: 'vertical', segundos: [0], html: '<html/>' })))
  const render = { composicion: preview.composicion, formato: 'vertical', duracion: 15, fps: 30, nombre: 'Promo' }
  const first = JSON.parse(text(await server.invoke(binding, 'render', render)))
  const rebound = { folder: '<chat>', chat: { directory, activeSession: async () => 'ses_rebind' } }
  const second = JSON.parse(text(await server.invoke(rebound, 'render', { ...render, nombre: 'Otro-nombre' })))
  expect(second.ruta).toBe(first.ruta)
})
