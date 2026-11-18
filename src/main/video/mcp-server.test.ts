import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, writeFile, readdir, rm, symlink, link, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { once } from 'node:events'
import { VideoMcpServer, type VideoBinding, type VideoRenderDeps } from './mcp-server'
import { MAX_ASSET_BYTES, MAX_COMPOSITION_FILES } from './composition'
import type { RenderJob } from './render-process'
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
    expect(JSON.parse(text(out)).cuadros[0]).toBe('/win/c/project/cuadro-cuadro-1.png')
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
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('Ahora no')
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
    expect(text(await server.invoke(binding, 'cuadros', args))).toContain('canceló')
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
    expect(JSON.parse(text(out)).composicion).toMatch(/^composicion-.+\/index.html$/)
    expect(JSON.parse(text(out)).cuadros[0]).not.toContain(dir)
    expect(
      (await server.invoke(binding, 'cuadros', { formato: 'vertical', segundos: [1], html: 'x'.repeat(512 * 1024 + 1) })).isError
    ).toBe(true)
    binding.chat!.activeSession = async () => null
    expect((await server.invoke(binding, 'cuadros', args)).isError).toBe(true)
    expect((await server.invoke({ folder: root }, 'cuadros', { ...args, html: '<html>' })).isError).toBe(true)
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
    expect(server.tools()).toHaveLength(2)
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
