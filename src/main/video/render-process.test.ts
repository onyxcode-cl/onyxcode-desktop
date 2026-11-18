import { EventEmitter } from 'node:events'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }))
vi.mock('node:child_process', () => mocks)
import { createRenderProcess, renderEnvironment, type RenderJob } from './render-process'
import { seatbeltLaunch, videoSandboxProfile } from './render-seatbelt'
// Igual que index.ts: Seatbelt solo en macOS.
const launcher = process.platform === 'darwin' ? seatbeltLaunch : undefined
let dir: string, job: RenderJob, child: EventEmitter & { pid: number; stdin: EventEmitter; stdout: EventEmitter; stderr: EventEmitter }
beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-video-process-')))
  const file = join(dir, 'binary')
  writeFileSync(file, '')
  job = {
    work: dir,
    composition: join(dir, 'index.html'),
    width: 1080,
    height: 1920,
    times: [1],
    node: file,
    paths: { chrome: file, ffmpeg: file, ffprobe: file, hyperframes: dir }
  }
  child = Object.assign(new EventEmitter(), {
    pid: 400001,
    stdin: new EventEmitter(),
    stdout: new EventEmitter(),
    stderr: new EventEmitter()
  })
  mocks.spawn.mockReset().mockReturnValue(child)
  mocks.spawnSync.mockReset()
  vi.spyOn(process, 'kill').mockImplementation(() => true)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})
describe('procesos del render', () => {
  it('solo permite escribir en su temporal; el perfil no permite internet', () => {
    const profile = videoSandboxProfile(job, job.node)
    expect(profile).toContain('(deny default)')
    expect(profile).toContain(`(allow file-write* (subpath ${JSON.stringify(dir)}) (literal "/dev/null"))`)
    expect(profile).toContain('(allow network-outbound (remote ip "localhost:*"))')
    expect(profile).not.toContain('(allow network*)')
    expect(profile).not.toContain('(allow file-read*)')
  })
  it('el entorno no hereda secretos, proxy, PATH, NODE_OPTIONS ni userData de la persona', () => {
    vi.stubEnv('NODE_OPTIONS', '--require /secret.js')
    vi.stubEnv('TOKEN', 'test-token')
    const env = renderEnvironment(dir, job.paths)
    expect(env).not.toHaveProperty('TOKEN')
    expect(env).not.toHaveProperty('NODE_OPTIONS')
    expect(env).not.toHaveProperty('PATH')
    expect(env).toMatchObject({
      HOME: dir,
      HYPERFRAMES_NO_UPDATE_CHECK: '1',
      HYPERFRAMES_NO_TELEMETRY: '1',
      HYPERFRAMES_NO_AUTO_INSTALL: '1',
      HYPERFRAMES_NO_OPTIONAL_INSTALL: '1',
      HYPERFRAMES_FFMPEG_PATH: job.paths.ffmpeg
    })
    vi.unstubAllEnvs()
  })
  it('lanza rutas absolutas, lee resultado y termina solo su grupo incluso tras éxito', async () => {
    const p = createRenderProcess(job.node, launcher)(job, new AbortController().signal)
    const [file, args, opts] = mocks.spawn.mock.calls[0]
    expect(file).toBe(process.platform === 'darwin' ? '/usr/bin/sandbox-exec' : job.node)
    expect(args).toContain(job.node)
    expect(opts).toMatchObject({ cwd: dir, windowsHide: true, detached: process.platform !== 'win32' })
    child.stdout.emit('data', Buffer.from('{"images":[]}'))
    child.emit('close', 0)
    expect(await p).toEqual({ images: [] })
    if (process.platform === 'win32')
      expect(mocks.spawnSync).toHaveBeenCalledWith(
        expect.stringMatching(/taskkill.exe$/),
        ['/PID', '400001', '/T', '/F'],
        expect.anything()
      )
    else expect(process.kill).toHaveBeenCalledWith(-400001, 'SIGKILL')
  })
  it('abortar mata el árbol propio y espera su cierre antes de devolver', async () => {
    const ac = new AbortController(),
      p = createRenderProcess(job.node, launcher)(job, ac.signal)
    ac.abort()
    child.emit('close', null)
    await expect(p).rejects.toThrow('canceló')
  })
  it('no lanza si ya estaba cancelado y no acepta salida inválida', async () => {
    await expect(createRenderProcess(job.node, launcher)(job, AbortSignal.abort())).rejects.toThrow()
    expect(mocks.spawn).not.toHaveBeenCalled()
    const p = createRenderProcess(job.node, launcher)(job, new AbortController().signal)
    child.stdout.emit('data', Buffer.from('invalid'))
    child.emit('close', 0)
    await expect(p).rejects.toThrow('resultado válido')
  })
  it('un fallo de Seatbelt se devuelve como error; no hay relanzamiento sin perfil', async () => {
    const p = createRenderProcess(job.node, launcher)(job, new AbortController().signal)
    child.stderr.emit('data', Buffer.from('sandbox_apply: Operation not permitted'))
    child.emit('close', 1)
    await expect(p).rejects.toThrow('aislamiento')
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })
})

it('preserva el código y los datos del worker en vez de culpar al sandbox', async () => {
  const p = createRenderProcess(job.node, launcher)(job, new AbortController().signal)
  child.stdout.emit('data', Buffer.from(JSON.stringify({ error: { code: 'formato_no_coincide', data: { width: 1920, height: 1080 } } })))
  child.emit('close', 1)
  await expect(p).rejects.toMatchObject({ renderCode: 'formato_no_coincide', data: { width: 1920, height: 1080 } })
})
