// El monitor sondea a OpenCode con la carpeta que ENTIENDE el servidor (`directory`, en Windows la ruta dentro de la distro) y no
// con la de la interfaz; en macOS (`directory` ausente) usa la misma carpeta de siempre.
import { describe, expect, it } from 'vitest'
import { DEFAULT_TASKS_PREFS } from '@shared/ipc-tasks'
import { TasksMonitor, type MonitorServer } from './monitor'

async function urlsFor(server: MonitorServer): Promise<string[]> {
  const urls: string[] = []
  const fakeFetch = (async (input: string | URL | Request) => {
    urls.push(String(input))
    return new Response('[]', { status: 200 })
  }) as typeof fetch
  const monitor = new TasksMonitor({
    servers: () => [server],
    stop: async () => undefined,
    prefs: { get: () => ({ ...DEFAULT_TASKS_PREFS, idleStopMinutes: 0 }) },
    tasks: { list: () => [] },
    notify: () => undefined,
    now: () => 1_000_000,
    fetch: fakeFetch
  })
  await monitor.poll()
  return urls
}

const base = { fullAccess: false, baseUrl: 'http://x', authorization: 'a', startedAt: 1, lastStartCallAt: 1 }

describe('monitor: directory del servidor', () => {
  it('con `directory` (Windows) todas las peticiones llevan la ruta de la distro', async () => {
    const urls = await urlsFor({ ...base, folder: 'C:\\lzx\\a b', directory: '/win/c/lzx/a b' })
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) expect(new URL(u).searchParams.get('directory')).toBe('/win/c/lzx/a b')
  })
  it('sin `directory` (macOS) usa la carpeta, igual que siempre', async () => {
    const urls = await urlsFor({ ...base, folder: '/Users/x/Docs' })
    for (const u of urls) expect(new URL(u).searchParams.get('directory')).toBe('/Users/x/Docs')
  })
})
