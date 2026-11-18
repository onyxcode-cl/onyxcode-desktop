import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { asegurarPiezasVideo, cleanupVideo, installVideo, removeVideo, validateVideoLock, videoPaths, videoStatus } from './install'
import { videoFixture } from './fixtures/install'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-video-unit-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('instalación video sin red', () => {
  it('asegurar solo lee, publica piezas completas, conserva licencias y npm sin scripts', async () => {
    const d = await videoFixture(root)
    expect(asegurarPiezasVideo(d)).toEqual({ state: 'missing', missingBytes: videoStatus(d).missingBytes })
    expect(d.fetch).not.toHaveBeenCalled()
    expect(d.run).not.toHaveBeenCalled()
    const phases: string[] = []
    await installVideo(d, (p) => phases.push(p.phase))
    expect(phases).toContain('npm')
    expect(videoStatus(d).ready).toBe(true)
    expect(asegurarPiezasVideo(d).state).toBe('ready')
    const p = videoPaths(d)!
    expect(statSync(p.chrome).mode & 0o111).toBeTruthy()
    expect(readFileSync(join(p.ffmpeg, '../LICENSE.GPL-3.0.txt'), 'utf8')).toContain('GNU GENERAL PUBLIC LICENSE')
    expect(readFileSync(join(p.ffmpeg, '../BUILD-CONFIG.txt'), 'utf8')).toContain('--enable-libx264')
    const npm = vi.mocked(d.run!).mock.calls.find(([, args]) => args.includes('ci'))!
    expect(npm[1]).toEqual(expect.arrayContaining(['--ignore-scripts', '--no-audit', '--no-fund']))
    expect(npm[2].env).not.toHaveProperty('NODE_OPTIONS')
    expect(npm[2].env.HOME).toContain('.tmp-')
    expect(readdirSync(d.videoDir).some((n) => n.startsWith('.tmp-'))).toBe(false)
    vi.mocked(d.fetch!).mockClear()
    vi.mocked(d.run!).mockClear()
    await installVideo(d)
    expect(d.fetch).not.toHaveBeenCalled()
    expect(d.run).not.toHaveBeenCalled()
    await removeVideo(d)
    expect(videoPaths(d)).toBeNull()
    expect(d.node().paths).not.toBeNull()
  })
  it.each(['size', 'sha256'] as const)('rechaza %s sin extraer ni ejecutar', async (field) => {
    const d = await videoFixture(root)
    const a = d.pin!.chrome.assets['darwin-arm64']
    if (field === 'size') a.size++
    else a.sha256 = '0'.repeat(64)
    await expect(installVideo(d)).rejects.toMatchObject({ code: 'hash' })
    expect(d.run).not.toHaveBeenCalled()
    expect(videoStatus(d).ready).toBe(false)
    expect(readdirSync(d.videoDir)).toEqual([])
  })
  it('instala Node primero; muestra sus bytes en el consentimiento', async () => {
    const d = await videoFixture(root)
    const node = d.node()
    let ready = false
    const base = videoStatus(d).missingBytes
    d.node = () => ({ ...node, paths: ready ? node.paths : null, missingBytes: ready ? 0 : 1000 })
    d.ensureNode = vi.fn(async () => {
      expect(d.fetch).not.toHaveBeenCalled()
      ready = true
      return node.paths!
    })
    expect(videoStatus(d).missingBytes).toBe(base + 1000)
    await installVideo(d)
    expect(d.ensureNode).toHaveBeenCalledOnce()
    expect(videoStatus(d).ready).toBe(true)
  })
  it('cancela antes de red y también antes de publicar un binario verificado', async () => {
    const d = await videoFixture(root)
    const ac = new AbortController()
    ac.abort()
    await expect(installVideo(d, undefined, ac.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(d.fetch).not.toHaveBeenCalled()
    const late = new AbortController()
    const original = d.run!
    d.run = async (...args) => {
      const out = await original(...args)
      late.abort()
      return out
    }
    await expect(installVideo(d, undefined, late.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(readdirSync(d.videoDir)).toEqual([])
  })
  it('rechaza nonfree, versión distinta, disco insuficiente y zip que exceda límites', async () => {
    const d = await videoFixture(root)
    d.freeBytes = async () => 0
    await expect(installVideo(d)).rejects.toMatchObject({ code: 'disk' })
    expect(d.fetch).not.toHaveBeenCalled()
    d.freeBytes = async () => 1e12
    d.pin!.chrome.assets['darwin-arm64'].unpackedMax = 1
    await expect(installVideo(d)).rejects.toThrow()
    expect(d.run).not.toHaveBeenCalled()
    const wrong = await videoFixture(root)
    wrong.run = async () => 'Chrome 0.0.0'
    await expect(installVideo(wrong)).rejects.toMatchObject({ code: 'broken' })
    const nonfree = await videoFixture(root)
    const original = nonfree.run!
    nonfree.run = async (...args) => `${await original(...args)} --enable-nonfree`
    await expect(installVideo(nonfree)).rejects.toMatchObject({ code: 'unsafe' })
    expect(videoPaths(nonfree)).toBeNull()
  })
  it('detecta archivos dañados y limpia temporales abandonados, sin borrar instalaciones', async () => {
    const d = await videoFixture(root)
    await installVideo(d)
    writeFileSync(videoPaths(d)!.ffprobe, 'broken changed size')
    expect(videoStatus(d).items.find((i) => i.id === 'ffprobe')?.state).toBe('broken')
    mkdirSync(join(d.videoDir, '.tmp-old'))
    await cleanupVideo(d.videoDir)
    expect(readdirSync(d.videoDir)).toContain('chrome-158.0.8127.36')
    expect(readdirSync(d.videoDir)).not.toContain('.tmp-old')
  })
  it('rechaza lock alterado antes de iniciar npm o descargar', async () => {
    const d = await videoFixture(root)
    d.pin!.hyperframes.lockSha256 = '0'.repeat(64)
    expect(() => validateVideoLock(d)).toThrow()
    await expect(installVideo(d)).rejects.toMatchObject({ code: 'hash' })
    expect(d.fetch).not.toHaveBeenCalled()
    expect(d.run).not.toHaveBeenCalled()
  })

  it('cancela npm, elimina su temporal y conserva los binarios completos para reintentar', async () => {
    const d = await videoFixture(root)
    const original = d.run!
    const ac = new AbortController()
    d.run = async (file, args, options) => {
      if (!args.includes('ci')) return original(file, args, options)
      return new Promise<string>((_, reject) => {
        options.signal!.addEventListener('abort', () => reject(new Error('abort')), { once: true })
        ac.abort()
      })
    }
    await expect(installVideo(d, undefined, ac.signal)).rejects.toMatchObject({ code: 'cancelled' })
    expect(readdirSync(d.videoDir).sort()).toEqual(['chrome-158.0.8127.36', 'ffmpeg-9.0.2', 'ffprobe-9.0.2'])
    expect(videoPaths(d)).toBeNull()
    d.run = original
    vi.mocked(d.fetch!).mockClear()
    await installVideo(d)
    expect(d.fetch).not.toHaveBeenCalled()
    expect(videoStatus(d).ready).toBe(true)
  })
})
