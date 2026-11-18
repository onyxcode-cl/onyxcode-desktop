import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installVideo, videoPaths, videoStatus } from './install'
import { videoFixture } from './fixtures/install'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-video-win-unit-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
describe('Windows x64 inyectado: ZIP y procesos falsos', () => {
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
