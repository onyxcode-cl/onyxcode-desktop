import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TASKS_PREFS } from '@shared/ipc-tasks'
import { TasksMonitor, type MonitorServer } from './monitor'

function fixture(keepWarm?: (folder: string, fullAccess: boolean) => boolean) {
  let now = 1_000_000
  const stop = vi.fn(async () => undefined)
  const servers: MonitorServer[] = ['a', 'b'].map((folder) => ({
    folder,
    fullAccess: false,
    baseUrl: `http://${folder}`,
    authorization: 'test',
    startedAt: 1,
    lastStartCallAt: 1
  }))
  let unavailable = false
  const monitor = new TasksMonitor({
    servers: () => servers,
    stop,
    keepWarm,
    prefs: { get: () => ({ ...DEFAULT_TASKS_PREFS, maxServers: 1, autoArchiveDays: 0 }) },
    tasks: { list: () => [] },
    notify: () => undefined,
    now: () => now,
    fetch: (async (input) => {
      if (unavailable) return new Response('', { status: 500 })
      const path = new URL(String(input)).pathname
      return new Response(path === '/session/status' ? '{}' : '[]')
    }) as typeof fetch
  })
  return {
    monitor,
    stop,
    servers,
    advance: () => {
      now += 16 * 60_000
    },
    fail: () => {
      unavailable = true
    }
  }
}

describe('motor en espera: inactividad y capacidad', () => {
  it('retiene solo el elegido; los demás se apagan tras 15 min', async () => {
    const f = fixture((folder) => folder === 'b')
    await f.monitor.poll()
    f.advance()
    await f.monitor.poll()
    await f.monitor.settle()
    expect(f.stop.mock.calls).toEqual([['a', false]])
  })
  it('sin selector conserva el apagado habitual de macOS', async () => {
    const f = fixture()
    await f.monitor.poll()
    f.advance()
    await f.monitor.poll()
    await f.monitor.settle()
    expect(f.stop).toHaveBeenCalledTimes(2)
  })
  it('el límite puede desalojar incluso el motor en espera con un sondeo fresco', async () => {
    const f = fixture(() => true)
    f.servers.pop()
    f.stop.mockImplementation(async () => {
      f.servers.length = 0
    })
    await f.monitor.ensureCapacity('nuevo', false)
    expect(f.stop.mock.calls).toEqual([['a', false]])
  })
  it('si no puede comprobar que está ocioso no desaloja para abrir otro', async () => {
    const f = fixture(() => true)
    f.fail()
    await f.monitor.ensureCapacity('nuevo', false)
    expect(f.stop).not.toHaveBeenCalled()
  })
})
