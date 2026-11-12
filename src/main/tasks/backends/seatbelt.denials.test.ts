import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import type { SandboxLaunchSpec } from './types'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), start: vi.fn(), stop: vi.fn(async () => {}), monitor: vi.fn() }))
vi.mock('./spawn', () => ({ spawnOnHost: mocks.spawn }))
vi.mock('../private-dir', () => ({
  ensureTaskPrivateDir: () => ({
    config: '/fixture/private/config',
    data: '/fixture/private/data',
    cache: '/fixture/private/cache',
    state: '/fixture/private/state',
    tmp: '/fixture/private/tmp'
  }),
  ensureTaskAppDirs: vi.fn()
}))
vi.mock('../models-cache', () => ({ seedConfigModels: () => null }))
vi.mock('../ripgrep-runtime', () => ({ bundledRipgrepPathEnv: () => ({}) }))
vi.mock('../sandbox-denials', () => ({
  SandboxDenialMonitor: class {
    constructor(...args: unknown[]) {
      mocks.monitor(...args)
    }
    start = mocks.start
    stop = mocks.stop
    killSync = vi.fn()
  }
}))
import { seatbeltBackend } from './seatbelt'
const spec = (): SandboxLaunchSpec => ({
  folder: '/fixture/tarea',
  isolation: { privateDir: '/fixture/private', userData: '/fixture/ud' },
  bin: '/fixture/engine',
  serveArgs: ['serve'],
  serverPort: 50000,
  configDir: '/fixture/config',
  allowDelete: false,
  outboundPorts: [],
  baseEnv: {},
  proxyEnv: {},
  onDenials: vi.fn()
})
const child = (): ChildProcess => Object.assign(new EventEmitter(), { exitCode: null, signalCode: null }) as ChildProcess
beforeEach(() => {
  vi.clearAllMocks()
  mocks.spawn.mockImplementation(() => child())
  mocks.stop.mockImplementation(async () => {})
})

describe('ciclo de vida del lector en Seatbelt', () => {
  it('etiquetas únicas por lanzamiento y lector vinculado al perfil exacto', async () => {
    const first = await seatbeltBackend.launch(spec())
    const second = await seatbeltBackend.launch(spec())
    const tags = mocks.monitor.mock.calls.map((c) => c[0])
    expect(new Set(tags).size).toBe(2)
    for (let i = 0; i < 2; i++) {
      expect(tags[i]).toMatch(/^lzx-denial-[a-f0-9]{32}$/)
      expect(mocks.spawn.mock.calls[i][1][1]).toContain(`(with message "${tags[i]}")`)
    }
    expect(mocks.start).toHaveBeenCalledTimes(2)
    await first.dispose()
    await second.dispose()
  })
  it('apagado no inicia lector; se puede encender y apagar con el servidor vivo', async () => {
    const onDenialControl = vi.fn()
    const launched = await seatbeltBackend.launch({ ...spec(), denialNotices: false, onDenialControl })
    expect(onDenialControl).toHaveBeenCalledOnce()
    const control = onDenialControl.mock.calls[0][0]
    expect(control.setEnabled).toBe(launched.setDenialNotices)
    control.killSync()
    expect(mocks.start).not.toHaveBeenCalled()
    launched.setDenialNotices?.(true)
    expect(mocks.start).toHaveBeenCalledTimes(1)
    launched.setDenialNotices?.(false)
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    launched.child.emit('close', 0)
    expect(mocks.stop).toHaveBeenCalledTimes(2)
    await launched.dispose()
  })
  it('dispose espera a que el monitor recoja el lector', async () => {
    let finish: (() => void) | undefined
    mocks.stop.mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          finish = r
        })
    )
    const launched = await seatbeltBackend.launch(spec())
    let done = false
    const disposed = launched.dispose().then(() => {
      done = true
    })
    await Promise.resolve()
    expect(done).toBe(false)
    finish?.()
    await disposed
    expect(done).toBe(true)
  })
  it('un fallo síncrono del lanzamiento limpia el lector', async () => {
    mocks.spawn.mockImplementationOnce(() => {
      throw new Error('spawn failed')
    })
    await expect(seatbeltBackend.launch(spec())).rejects.toThrow('spawn failed')
    expect(mocks.stop).toHaveBeenCalledTimes(1)
  })
  it('un error asíncrono del proceso limpia el lector y no reinicia un proceso terminado', async () => {
    const launched = await seatbeltBackend.launch(spec())
    launched.child.emit('error', new Error('ENOENT'))
    expect(mocks.stop).toHaveBeenCalledTimes(1)
    launched.setDenialNotices?.(true)
    expect(mocks.start).toHaveBeenCalledTimes(1)
    await launched.dispose()
  })
})
