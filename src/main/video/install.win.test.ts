import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installVideo, videoPaths, videoStatus } from './install'
import { videoFixture } from './fixtures/install'

vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>()
  return { ...fs, rename: vi.fn(fs.rename) }
})

vi.mock('node:timers/promises', async (original) => {
  const timers = await original<typeof import('node:timers/promises')>()
  return { ...timers, setTimeout: vi.fn(timers.setTimeout) }
})

let root: string
beforeEach(async () => {
  const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  const timers = await vi.importActual<typeof import('node:timers/promises')>('node:timers/promises')
  vi.mocked(rename).mockReset().mockImplementation(fs.rename)
  vi.mocked(delay).mockReset().mockImplementation(timers.setTimeout)
  root = mkdtempSync(join(tmpdir(), 'lzx-video-win-unit-'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})
describe('Windows x64 inyectado: ZIP y procesos falsos', () => {
  it.each(['EPERM', 'EBUSY', 'EACCES'])('reintenta %s tras verificar ffmpeg y publica una sola pieza completa', async (code) => {
    const d = await videoFixture(root, 'win32')
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    let failures = 0
    vi.mocked(delay).mockResolvedValue(undefined)
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(to).includes('ffmpeg-')) {
        expect(vi.mocked(d.run!).mock.calls.some(([file]) => file.endsWith('ffprobe.exe'))).toBe(true)
        if (failures++ < 2) throw Object.assign(new Error('blocked'), { code })
      }
      await fs.rename(from, to)
    })
    await installVideo(d)
    expect(failures).toBe(3)
    expect(vi.mocked(delay).mock.calls.map(([ms]) => ms)).toEqual([100, 200])
    expect(log).toHaveBeenCalledWith('[video:install] rename', { id: 'ffmpeg', code, attempt: 1 })
    expect(videoStatus(d).ready).toBe(true)
    expect(readdirSync(d.videoDir).sort()).toEqual(['chrome-158.0.8127.36', 'ffmpeg-9.0.2', 'hyperframes-0.9.64'])
    expect(d.fetch).toHaveBeenCalledTimes(2)
  })

  it('agota el plazo con el código real y no publica ni deja temporales', async () => {
    const d = await videoFixture(root, 'win32')
    vi.mocked(delay).mockResolvedValue(undefined)
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith('stage')) throw Object.assign(new Error('blocked'), { code: 'EPERM' })
      await fs.rename(from, to)
    })
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(installVideo(d)).rejects.toMatchObject({ code: 'permission', detail: 'rename chrome: EPERM' })
    expect(vi.mocked(rename).mock.calls.filter(([from]) => String(from).endsWith('stage'))).toHaveLength(8)
    expect(vi.mocked(delay).mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400, 800, 1000, 1000, 1000])
    expect(log).toHaveBeenLastCalledWith('[video:install] rename', { id: 'chrome', code: 'EPERM', attempt: 8 })
    expect(readdirSync(d.videoDir)).toEqual([])
  })

  it('no reintenta errores permanentes y cancela durante la espera', async () => {
    const d = await videoFixture(root, 'win32')
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith('stage')) throw Object.assign(new Error('full'), { code: 'ENOSPC' })
      await fs.rename(from, to)
    })
    await expect(installVideo(d)).rejects.toMatchObject({ code: 'disk', detail: 'rename chrome: ENOSPC' })
    expect(vi.mocked(rename).mock.calls.filter(([from]) => String(from).endsWith('stage'))).toHaveLength(1)
    vi.mocked(rename).mockClear()
    const ac = new AbortController()
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith('stage')) {
        setTimeout(() => ac.abort(), 10)
        throw Object.assign(new Error('blocked'), { code: 'EBUSY' })
      }
      await fs.rename(from, to)
    })
    await expect(installVideo(d, undefined, ac.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(vi.mocked(rename).mock.calls.filter(([from]) => String(from).endsWith('stage'))).toHaveLength(1)
    expect(log).toHaveBeenCalled()
    expect(readdirSync(d.videoDir)).toEqual([])
  })

  it('no reintenta EPERM fuera de Windows', async () => {
    const d = await videoFixture(root)
    const fs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(rename).mockImplementation(async (from, to) => {
      if (String(from).endsWith('stage')) throw Object.assign(new Error('blocked'), { code: 'EPERM' })
      await fs.rename(from, to)
    })
    await expect(installVideo(d)).rejects.toMatchObject({ code: 'permission', detail: 'rename chrome: EPERM' })
    expect(delay).not.toHaveBeenCalled()
    expect(readdirSync(d.videoDir)).toEqual([])
  })

  it('instala .exe nativos, ffprobe desde el mismo ZIP y npm-cli.js por Node, sin npm.cmd ni shell', async () => {
    const d = await videoFixture(root, 'win32')
    await installVideo(d)
    expect(videoStatus(d).ready).toBe(true)
    const p = videoPaths(d)!
    expect(p.chrome).toBe(join(d.videoDir, 'chrome-158.0.8127.36/chrome-headless-shell.exe'))
    expect(p.ffmpeg).toBe(join(d.videoDir, 'ffmpeg-9.0.2/bin/ffmpeg.exe'))
    expect(p.ffprobe).toBe(join(d.videoDir, 'ffmpeg-9.0.2/bin/ffprobe.exe'))
    expect(readFileSync(p.ffprobe, 'utf8')).toBe('fake ffprobe')
    expect(d.fetch).toHaveBeenCalledTimes(2)
    const npm = vi.mocked(d.run!).mock.calls.find(([, args]) => args.includes('ci'))!
    expect(npm[0]).toBe(d.node().paths!.bin)
    expect(npm[1][0]).toBe(d.node().paths!.npmCli)
    expect(npm[2].env.PATH.split(';')[0]).toBe(join(root, 'node'))
  })
  it('un zip con SHA distinto nunca llega a ejecutar un .exe', async () => {
    const d = await videoFixture(root, 'win32')
    d.pin!.chrome.assets['win32-x64'].sha256 = '0'.repeat(64)
    await expect(installVideo(d)).rejects.toMatchObject({ code: 'hash' })
    expect(d.run).not.toHaveBeenCalled()
    expect(videoPaths(d)).toBeNull()
  })
})
