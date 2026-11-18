import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, net: {} }))
import { VideoService } from './service'
import { videoFixture } from './fixtures/install'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lzx-video-service-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))
describe('servicio de video', () => {
  it('comparte una instalación, impide quitar mientras instala y permite cancelar', async () => {
    const d = await videoFixture(root)
    const s = new VideoService(() => d)
    expect(s.asegurarPiezasVideo().state).toBe('missing')
    expect(d.fetch).not.toHaveBeenCalled()
    const promise = s.instalar()
    expect(s.instalar()).toBe(promise)
    expect(s.estado().installing).toBe(true)
    await expect(s.quitar()).rejects.toMatchObject({ code: 'busy' })
    s.cancelar()
    expect(await promise).toEqual({ ok: false, error: 'cancelled' })
    expect(s.estado().installing).toBe(false)
    expect(await s.instalar()).toEqual({ ok: true })
    expect(s.rutas()).not.toBeNull()
    await s.quitar()
    expect(s.rutas()).toBeNull()
  })
  it('un lockfile incluido ausente informa io sin pedir red', async () => {
    const d = await videoFixture(root)
    cpSync(d.resourcesDir, join(root, 'resources'), { recursive: true })
    d.resourcesDir = join(root, 'resources')
    rmSync(join(d.resourcesDir, 'hyperframes', 'package-lock.json'))
    const s = new VideoService(() => d)
    expect(await s.instalar()).toEqual({ ok: false, error: 'io' })
    expect(s.estado().error).toBe('io')
    expect(d.fetch).not.toHaveBeenCalled()
  })
  it('falla cerrado sin pin o en plataforma no soportada', async () => {
    const d = await videoFixture(root)
    d.pin = null
    const s = new VideoService(() => d)
    expect(s.estado().offered).toBe(false)
    expect(s.asegurarPiezasVideo()).toEqual({ state: 'unsupported' })
    expect(await s.instalar()).toEqual({ ok: false, error: 'unsupported' })
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('permite reintentar si leer las dependencias falla antes del primer await', async () => {
    const d = await videoFixture(root)
    let fail = true
    const s = new VideoService(() => {
      if (fail) throw new Error('io')
      return d
    })
    expect((await s.instalar()).ok).toBe(false)
    fail = false
    expect(await s.instalar()).toEqual({ ok: true })
  })
})
