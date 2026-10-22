import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENGINE_EXPERIMENTS_DEFAULTS } from '@shared/engine-experiments'
import type { EngineExperiments, ServerState } from '@shared/types'
import { installEngineFlagsRestart, type EngineFlagsLiveServer, type EngineFlagsRestartDeps } from './engine-flags-restart'

type S = { engineExperiments: EngineExperiments; recentFolders?: string[]; theme?: string }

const on = (over: Partial<EngineExperiments>): EngineExperiments => ({ ...ENGINE_EXPERIMENTS_DEFAULTS, ...over })
const flag = (chat: boolean, code: boolean, tasks: boolean) => ({ chat, code, tasks })

function harness(initial: S, opts: { idle?: boolean; serverState?: ServerState; live?: EngineFlagsLiveServer[] } = {}) {
  let current = initial
  const listeners = new Set<(s: S) => void>()
  const idle = { value: opts.idle ?? true }
  const server = {
    restart: vi.fn(async () => undefined),
    getStatus: () => ({ state: opts.serverState ?? ('ready' as ServerState), restarts: 0 }),
    getConnection: () => ({ baseUrl: 'http://main', authorization: 'a', username: 'u', chatDirectory: '/chat' })
  }
  const live = opts.live ?? []
  const tasks = { liveServers: () => live, restartSandbox: vi.fn(async () => true) }
  const isIdle = vi.fn(async (_url: string, _auth: string, _dirs: string[]) => idle.value)
  const notify = vi.fn()
  const deps: EngineFlagsRestartDeps = {
    settings: {
      get: () => current,
      onChange: (l) => {
        listeners.add(l)
        return () => listeners.delete(l)
      }
    },
    server,
    tasks,
    chatDirectory: '/chat',
    isIdle,
    notify,
    retryMs: 1000,
    now: () => Date.now()
  }
  const dispose = installEngineFlagsRestart(deps)
  const change = async (next: S): Promise<void> => {
    current = next
    listeners.forEach((l) => l(next))
    await vi.advanceTimersByTimeAsync(0)
  }
  return { server, tasks, isIdle, notify, idle, change, dispose }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
})
afterEach(() => vi.useRealTimers())

const base: S = { engineExperiments: ENGINE_EXPERIMENTS_DEFAULTS }

describe('reinicio al cambiar las funciones experimentales', () => {
  it('reinicia el sidecar principal si cambió su entorno y está ocioso', async () => {
    const h = harness(base)
    await h.change({ engineExperiments: on({ codeMode: flag(false, true, false) }) })
    expect(h.server.restart).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith('restarted')
    expect(h.tasks.restartSandbox).not.toHaveBeenCalled()
  })

  it('un cambio irrelevante de Ajustes no reinicia nada', async () => {
    const h = harness(base)
    await h.change({ ...base, theme: 'dark', recentFolders: ['/x'] })
    expect(h.server.restart).not.toHaveBeenCalled()
    expect(h.isIdle).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('Chat y Code comparten sidecar: apagar uno estando el otro encendido no reinicia', async () => {
    const h = harness({ engineExperiments: on({ codeMode: flag(true, true, false) }) })
    await h.change({ engineExperiments: on({ codeMode: flag(false, true, false) }) })
    await h.change({ engineExperiments: on({ codeMode: flag(true, true, false) }) })
    expect(h.server.restart).not.toHaveBeenCalled()
  })

  it('un cambio solo de Tareas no toca el sidecar principal', async () => {
    const live: EngineFlagsLiveServer[] = [
      { folder: '/p', directory: '/p', fullAccess: false, baseUrl: 'http://t', authorization: 'b', startedAt: 1 }
    ]
    const h = harness(base, { live })
    await h.change({ engineExperiments: on({ backgroundSubagents: flag(false, false, true) }) })
    expect(h.server.restart).not.toHaveBeenCalled()
    expect(h.tasks.restartSandbox).toHaveBeenCalledWith('/p')
  })

  it('con turnos en curso avisa una vez, espera y reinicia cuando queda ocioso', async () => {
    const h = harness(base, { idle: false })
    await h.change({ engineExperiments: on({ codeMode: flag(false, true, false) }) })
    expect(h.server.restart).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenLastCalledWith('pending')
    await vi.advanceTimersByTimeAsync(3000)
    expect(h.server.restart).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledTimes(1)
    h.idle.value = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.server.restart).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenLastCalledWith('restarted')
  })

  it('si la persona deshace el cambio antes de que acabe el turno, no reinicia', async () => {
    const h = harness(base, { idle: false })
    await h.change({ engineExperiments: on({ codeMode: flag(false, true, false) }) })
    await h.change(base)
    h.idle.value = true
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.server.restart).not.toHaveBeenCalled()
  })

  it('Overdrive: reinicia solo los sandbox ociosos, no Control total ni los nacidos después del cambio', async () => {
    const live: EngineFlagsLiveServer[] = [
      { folder: '/a', directory: '/a', fullAccess: false, baseUrl: 'http://a', authorization: 'a', startedAt: 1 },
      { folder: '/b', directory: '/b', fullAccess: false, baseUrl: 'http://b', authorization: 'b', startedAt: 1 },
      { folder: '/full', directory: '/full', fullAccess: true, baseUrl: 'http://f', authorization: 'f', startedAt: 1 },
      { folder: '/new', directory: '/new', fullAccess: false, baseUrl: 'http://n', authorization: 'n', startedAt: 99_999 }
    ]
    const h = harness(base, { live })
    h.isIdle.mockImplementation(async (url: string) => url !== 'http://b')
    await h.change({ engineExperiments: on({ codeMode: flag(false, false, true) }) })
    expect(h.tasks.restartSandbox).toHaveBeenCalledTimes(1)
    expect(h.tasks.restartSandbox).toHaveBeenCalledWith('/a')
    expect(h.notify).toHaveBeenCalledWith('pending')
    h.isIdle.mockImplementation(async () => true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.tasks.restartSandbox).toHaveBeenCalledTimes(2)
    expect(h.tasks.restartSandbox).toHaveBeenLastCalledWith('/b')
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.tasks.restartSandbox).toHaveBeenCalledTimes(2)
  })

  it('sidecar parado: no lo reinicia (el próximo arranque ya lee los Ajustes)', async () => {
    const h = harness(base, { serverState: 'stopped' })
    await h.change({ engineExperiments: on({ codeMode: flag(false, true, false) }) })
    expect(h.server.restart).not.toHaveBeenCalled()
    expect(h.notify).not.toHaveBeenCalled()
  })

  it('el estado del sidecar se consulta en el directorio de Chat y en las carpetas recientes', async () => {
    const h = harness({ ...base, recentFolders: ['/r1'] })
    await h.change({ engineExperiments: on({ codeMode: flag(false, true, false) }), recentFolders: ['/r1', '/r2'] })
    expect(h.isIdle).toHaveBeenCalledWith('http://main', 'a', ['/chat', '/r1', '/r2'])
  })

  it('al quitar el listener deja de reaccionar', async () => {
    const h = harness(base)
    h.dispose()
    await h.change({ engineExperiments: on({ codeMode: flag(false, true, false) }) })
    expect(h.server.restart).not.toHaveBeenCalled()
  })
})

describe('config inline del sidecar principal (conectores en Code, F8-B203)', () => {
  type T = S & { codeTrustedMcp?: string[] }
  /** El «servidor» arranca con la huella de los Ajustes de ese momento (como `server.ts`). */
  function inlineHarness(opts: { idle?: boolean } = {}) {
    let current: T = { ...base, codeTrustedMcp: [] }
    const listeners = new Set<(s: S) => void>()
    const idle = { value: opts.idle ?? true }
    const extra = { value: '' }
    const wanted = (): string => JSON.stringify(current.codeTrustedMcp) + extra.value
    let applied: string | null = wanted()
    const server = {
      restart: vi.fn(async () => {
        applied = wanted()
      }),
      getStatus: () => ({ state: 'ready' as ServerState, restarts: 0 }),
      getConnection: () => ({ baseUrl: 'http://main', authorization: 'a', username: 'u', chatDirectory: '/chat' })
    }
    const notify = vi.fn()
    const handle = installEngineFlagsRestart({
      settings: {
        get: () => current,
        onChange: (l) => {
          listeners.add(l)
          return () => listeners.delete(l)
        }
      },
      server,
      chatDirectory: '/chat',
      isIdle: async () => idle.value,
      notify,
      retryMs: 1000,
      mainInline: { wanted, applied: () => applied }
    })
    const change = async (next: Partial<T>): Promise<void> => {
      current = { ...current, ...next }
      listeners.forEach((l) => l(current))
      await vi.advanceTimersByTimeAsync(0)
    }
    return { server, notify, idle, extra, change, handle }
  }

  it('marcar un conector de confianza reinicia (ocioso) y avisa con el texto de conectores', async () => {
    const h = inlineHarness()
    await h.change({ codeTrustedMcp: ['gmail'] })
    expect(h.server.restart).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledWith('restarted', 'connectors')
  })

  it('con turnos en curso NO reinicia: avisa una vez y espera a que quede ocioso', async () => {
    const h = inlineHarness({ idle: false })
    await h.change({ codeTrustedMcp: ['gmail'] })
    expect(h.server.restart).not.toHaveBeenCalled()
    expect(h.notify).toHaveBeenCalledWith('pending', 'connectors')
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.server.restart).not.toHaveBeenCalled()
    h.idle.value = true
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.server.restart).toHaveBeenCalledTimes(1)
    expect(h.notify).toHaveBeenCalledTimes(2)
  })

  it('recheck(): un conector nuevo (sin cambio de Ajustes) también reinicia; sin cambios no hace nada', async () => {
    const h = inlineHarness()
    h.handle.recheck()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.server.restart).not.toHaveBeenCalled()
    h.extra.value = '+crm'
    h.handle.recheck()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.server.restart).toHaveBeenCalledTimes(1)
  })

  it('un fallo al calcular la huella no reinicia a ciegas', async () => {
    const h = inlineHarness()
    h.extra.value = '+x'
    const boom = vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(h.extra, 'value', {
      get: () => {
        throw new Error('ilegible')
      }
    })
    h.handle.recheck()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.server.restart).not.toHaveBeenCalled()
    boom.mockRestore()
  })

  it('tras dispose, recheck no hace nada', async () => {
    const h = inlineHarness()
    h.handle()
    h.extra.value = '+crm'
    h.handle.recheck()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.server.restart).not.toHaveBeenCalled()
  })
})
