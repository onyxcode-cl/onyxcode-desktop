import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSessionsIdle } from './engine-flags-restart'

/** Motor falso: `sessions` (lista experimental) y `status` por carpeta. */
function fakeEngine(opts: {
  sessions?: Array<{ id: string; directory: string; parentID?: string }> | 'missing'
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
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat'])).toBe(false)
  })

  it('mira carpetas que el motor conoce aunque no estén en las recientes', async () => {
    const asked = fakeEngine({ sessions: [{ id: 'x', directory: '/vieja' }], status: { '/vieja': { x: { type: 'busy' } } } })
    expect(await fetchSessionsIdle('http://x', 'auth', ['/chat', '/reciente'])).toBe(false)
    expect(asked).toContain('/vieja')
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
