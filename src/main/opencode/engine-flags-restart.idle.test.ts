import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearWorkForTests, noteWork } from '../code/work-registry'
import { fetchSessionsIdle } from './engine-flags-restart'

/** Motor falso: `sessions` (lista experimental) y `status` por carpeta. */
function fakeEngine(opts: {
  sessions?: Array<{ id: string; directory: string; parentID?: string; time?: { updated: number } }> | 'missing'
  status: Record<string, unknown>
}) {
  const asked: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      const url = new URL(input)
      if (url.pathname === '/experimental/session') {
        if (opts.sessions === 'missing' || !opts.sessions) return new Response('no', { status: 404 })
        return Response.json(opts.sessions)
      }
      if (url.pathname === '/session/status') {
        const dir = url.searchParams.get('directory') ?? ''
        asked.push(dir)
        return Response.json(opts.status[dir] ?? {})
      }
      return new Response('?', { status: 404 })
    })
  )
  return asked
}

afterEach(() => vi.unstubAllGlobals())

describe('fetchSessionsIdle: «nada en curso» de verdad', () => {
  it('ocioso si todas las carpetas están ociosas', async () => {
    fakeEngine({ sessions: [{ id: 'a', directory: '/p' }], status: {} })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat'])).toBe(true)
  })

  it('no ocioso si un subagente hijo está busy (la raíz figura ociosa)', async () => {
    fakeEngine({
      sessions: [
        { id: 'raiz', directory: '/p' },
        { id: 'hijo', directory: '/p', parentID: 'raiz' }
      ],
      status: { '/p': { hijo: { type: 'busy' } } }
    })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat', '/p'])).toBe(false)
  })

  it('R2: una carpeta que el motor conoce pero que NO se dio NUNCA se consulta (consultarla la carga); con actividad vieja no cuenta', async () => {
    const asked = fakeEngine({
      sessions: [{ id: 'x', directory: '/vieja', time: { updated: Date.now() - 10 * 60_000 } }],
      status: { '/vieja': { x: { type: 'busy' } } }
    })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat', '/abierta'])).toBe(true)
    expect(asked).toEqual(['/chat', '/abierta'])
  })

  it('R2: una carpeta no dada con actividad reciente aplaza el reinicio SIN consultarla', async () => {
    const asked = fakeEngine({
      sessions: [{ id: 'x', directory: '/ajena', time: { updated: Date.now() - 5_000 } }],
      status: { '/ajena': { x: { type: 'busy' } } }
    })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat'])).toBe(false)
    expect(asked).not.toContain('/ajena')
  })

  it('R2: la carpeta dada se consulta con su estado real aunque tenga actividad reciente; separadores y barra final no la duplican', async () => {
    const asked = fakeEngine({
      sessions: [{ id: 'x', directory: 'C:\\Work\\Abierta', time: { updated: Date.now() - 1_000 } }],
      status: { 'C:/Work/Abierta/': {} }
    })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat', 'C:/Work/Abierta/'])).toBe(true)
    expect(asked).toEqual(['/chat', 'C:/Work/Abierta/'])
  })

  it('R2: en Mac/Linux «/w/Abierta» y «/w/abierta» son carpetas distintas: la que no se dio y tiene actividad reciente aplaza, sin consultarla', async () => {
    const asked = fakeEngine({ sessions: [{ id: 'x', directory: '/w/abierta', time: { updated: Date.now() - 1_000 } }], status: {} })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat', '/w/Abierta'])).toBe(false)
    expect(asked).not.toContain('/w/abierta')
  })

  it('R2: trabajo que un servicio (Rutinas, Telegram, celular) mandó a una carpeta no consultada aplaza el reinicio aunque time.updated sea viejo (comando largo)', async () => {
    clearWorkForTests()
    noteWork('/rutina')
    const asked = fakeEngine({ sessions: [{ id: 'x', directory: '/rutina', time: { updated: Date.now() - 10 * 60_000 } }], status: {} })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat'])).toBe(false)
    expect(asked).toEqual([]) // ni siquiera la consultó
    clearWorkForTests()
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat'])).toBe(true)
  })

  it('un reintento (retry) cuenta como en curso', async () => {
    fakeEngine({ sessions: 'missing', status: { '/chat': { s: { type: 'retry' } } } })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat'])).toBe(false)
  })

  it('si el motor no ofrece la lista experimental se usan solo las carpetas dadas', async () => {
    const asked = fakeEngine({ sessions: 'missing', status: {} })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat'])).toBe(true)
    expect(asked).toEqual(['/chat'])
  })

  it('cualquier fallo del estado = no ocioso', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('caído')))
    )
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat'])).toBe(false)
  })
})
