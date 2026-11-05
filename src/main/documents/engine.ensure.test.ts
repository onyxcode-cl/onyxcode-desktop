/** `ensureCraft`: ArtCraft se instala bajo demanda (macOS y Windows), una sola vez a la vez, sin repetir un fallo reciente y sin lanzar. */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const status = vi.fn()
const installNow = vi.fn()
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))
vi.mock('../office/craft/service', () => ({ craftService: () => ({ status, installNow }) }))
vi.mock('../extras/artifact-window', () => ({ renderHtmlToPdf: vi.fn() }))

let engine: typeof import('./engine')

beforeEach(async () => {
  vi.resetModules()
  status.mockReset()
  installNow.mockReset()
  delete process.env.LAZUNOX_CRAFT_AUTOINSTALL
  engine = await import('./engine')
  engine.resetEnsureCraftForTests()
})

describe('ensureCraft', () => {
  it('instala cuando falta', async () => {
    status.mockReturnValue({ state: 'missing', version: '1', sizeBytes: 1 })
    installNow.mockResolvedValue({ ok: true })
    await engine.ensureCraft()
    expect(installNow).toHaveBeenCalledTimes(1)
  })

  it('no hace nada si ya está instalado o la plataforma no está soportada', async () => {
    status.mockReturnValue({ state: 'installed', version: '1', bin: 'x', bins: {} })
    await engine.ensureCraft()
    status.mockReturnValue({ state: 'unsupported', reason: 'x' })
    await engine.ensureCraft()
    expect(installNow).not.toHaveBeenCalled()
  })

  it('dos documentos a la vez comparten la misma instalación', async () => {
    status.mockReturnValue({ state: 'missing', version: '1', sizeBytes: 1 })
    let done!: () => void
    installNow.mockReturnValue(new Promise((r) => (done = () => r({ ok: true }))))
    const a = engine.ensureCraft()
    const b = engine.ensureCraft()
    done()
    await Promise.all([a, b])
    expect(installNow).toHaveBeenCalledTimes(1)
  })

  it('tras un fallo no repite durante 10 minutos, y después sí', async () => {
    status.mockReturnValue({ state: 'missing', version: '1', sizeBytes: 1 })
    installNow.mockResolvedValue({ ok: false, error: 'network', message: 'x' })
    let t = 1_000_000
    await engine.ensureCraft(() => t)
    await engine.ensureCraft(() => (t += 60_000))
    expect(installNow).toHaveBeenCalledTimes(1)
    await engine.ensureCraft(() => (t += 11 * 60_000))
    expect(installNow).toHaveBeenCalledTimes(2)
  })

  it('nunca lanza, aunque la instalación reviente', async () => {
    status.mockReturnValue({ state: 'missing', version: '1', sizeBytes: 1 })
    installNow.mockRejectedValue(new Error('boom'))
    await expect(engine.ensureCraft()).resolves.toBeUndefined()
  })

  it('LAZUNOX_CRAFT_AUTOINSTALL=0 lo apaga', async () => {
    process.env.LAZUNOX_CRAFT_AUTOINSTALL = '0'
    status.mockReturnValue({ state: 'missing', version: '1', sizeBytes: 1 })
    await engine.ensureCraft()
    expect(installNow).not.toHaveBeenCalled()
  })
})
