/**
 * «Cambios de este turno» y rebobinar en el store de Code: carga de turnos (404 = motor sin soporte, vuelve el Revertir de siempre),
 * el celular no los pide, rebobinar con aviso y «Deshacer» por la ruta nueva (y por `unrevert` de siempre si no hay nada que deshacer).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, type TraceEvent } from '../../../../../test/fixtures/events'
import type { OcEvent } from '../../../lib/opencode'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'
const fetchMock = vi.fn()

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })
const calls = (): string[] =>
  fetchMock.mock.calls.map((c) => `${(c[1] as RequestInit | undefined)?.method ?? 'GET'} ${new URL(c[0] as string).pathname}`)

const turn = (messageID: string, files = 1): Record<string, unknown> => ({
  messageID,
  time: 1,
  restaurable: true,
  truncated: false,
  files: Array.from({ length: files }, (_, i) => ({
    file: `f${i}.ts`,
    status: 'modified',
    additions: 2,
    deletions: 1,
    origen: 'herramienta'
  }))
})

function install(extra: Record<string, unknown> = {}): { unrevert: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } {
  const unrevert = vi.fn(async () => ({ data: makeSession('s1', D) }))
  const get = vi.fn(async () => ({ data: makeSession('s1', D) }))
  useServer.setState({
    client: {
      permission: { reply: vi.fn(), list: () => Promise.resolve({ data: [] }) },
      session: { unrevert, get, status: () => Promise.resolve({ data: {} }), list: () => Promise.resolve({ data: [] }), ...extra },
      question: { list: () => Promise.resolve({ data: [] }) }
    } as never,
    connection: { baseUrl: 'http://127.0.0.1:4999', authorization: 'Basic abc', chatDirectory: '/chat' } as never
  })
  return { unrevert, get }
}

async function boot(): Promise<void> {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
}

beforeEach(async () => {
  await boot()
})

const open = (): void => {
  const te: TraceEvent = sessionCreated(makeSession('s1', D))
  st().applyEvent(te.event as OcEvent, te.directory)
  useCode.setState({ activeSessionID: 's1', sessionProject: { s1: D } })
}

describe('loadTurns', () => {
  it('guarda los turnos y marca el soporte; recargar lo mismo no cambia las referencias', async () => {
    install()
    open()
    fetchMock.mockImplementation(async () => json([turn('m1', 2), turn('m2', 1)]))
    await st().loadTurns('s1')
    expect(st().rewindSupport.s1).toBe(true)
    expect(st().turnsBySession.s1.map((t) => t.messageID)).toEqual(['m1', 'm2'])
    expect(calls()).toEqual(['GET /experimental/session/s1/turnos'])
    expect(String(fetchMock.mock.calls[0][0])).toContain('directory=%2Fwork%2Fcode')
    const before = st().turnsBySession.s1
    await st().loadTurns('s1')
    expect(st().turnsBySession.s1).toBe(before)
  })

  it('404: el motor no tiene las rutas; se recuerda, no se vuelve a preguntar y no se abre el diálogo', async () => {
    install()
    open()
    fetchMock.mockImplementation(async () => json({}, 404))
    await st().loadTurns('s1')
    expect(st().rewindSupport.s1).toBe(false)
    await st().loadTurns('s1')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(st().openRewind('m1')).toBe(false)
    expect(st().rewindDialog).toBeNull()
  })

  it('un fallo pasajero (500, red) no cambia nada', async () => {
    install()
    open()
    fetchMock
      .mockImplementationOnce(async () => json({}, 500))
      .mockImplementationOnce(async () => {
        throw new Error('red')
      })
    await st().loadTurns('s1')
    await st().loadTurns('s1')
    expect(st().rewindSupport.s1).toBeUndefined()
    expect(st().turnsBySession.s1).toBeUndefined()
  })

  it('el celular no los pide ni abre el diálogo (rutas X: nunca llegarían)', async () => {
    const g = globalThis as { window?: unknown }
    const before = g.window
    g.window = { ...(before as object | undefined), api: { platform: 'remote' } }
    try {
      await boot()
      install()
      open()
      fetchMock.mockImplementation(async () => json([turn('m1')]))
      await st().loadTurns('s1')
      expect(fetchMock).not.toHaveBeenCalled()
      expect(st().turnsBySession).toEqual({})
      useCode.setState({ rewindSupport: { s1: true } })
      expect(st().openRewind('m1')).toBe(false)
    } finally {
      if (before === undefined) delete g.window
      else g.window = before
    }
  })

  it('un evento session.diff recarga los turnos de esa sesión (con espera)', async () => {
    vi.useFakeTimers()
    try {
      install()
      open()
      fetchMock.mockImplementation(async () => json([turn('m1')]))
      st().applyEvent({ id: 'e_diff', type: 'session.diff', properties: { sessionID: 's1', diff: [] } } as unknown as OcEvent, D)
      expect(fetchMock).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(800)
      expect(calls()).toEqual(['GET /experimental/session/s1/turnos'])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('rebobinar', () => {
  it('openRewind solo con soporte confirmado; closeRewind lo cierra', async () => {
    install()
    open()
    expect(st().openRewind('m1')).toBe(false)
    useCode.setState({ rewindSupport: { s1: true } })
    expect(st().openRewind('m1')).toBe(true)
    expect(st().rewindDialog).toEqual({ sessionID: 's1', messageID: 'm1' })
    st().closeRewind()
    expect(st().rewindDialog).toBeNull()
  })

  it('rewindTo manda el modo y SOLO lo marcado; deja el aviso con «Deshacer» y relee la sesión y los turnos', async () => {
    const { get } = install()
    open()
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? json({
            modo: 'todo',
            restaurados: ['a.ts'],
            borrados: ['b.ts'],
            omitidos: [{ file: 'c.ts', motivo: 'conflicto' }],
            mensajesOcultos: 3,
            puedeDeshacer: true
          })
        : json([turn('m1')])
    )
    const r = await st().rewindTo('s1', 'm1', 'todo', ['x.ts'])
    expect(r.ok).toBe(true)
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!
    expect(new URL(post[0] as string).pathname).toBe('/experimental/session/s1/rebobinar')
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ messageID: 'm1', modo: 'todo', sobrescribir: ['x.ts'] })
    expect(st().rewindNotices.s1).toMatchObject({
      kind: 'done',
      modo: 'todo',
      restaurados: 1,
      borrados: 1,
      mensajesOcultos: 3,
      puedeDeshacer: true
    })
    expect(st().rewindNotices.s1.omitidos).toEqual([{ file: 'c.ts', motivo: 'conflicto' }])
    expect(get).toHaveBeenCalled()
    await vi.waitFor(() => expect(st().turnsBySession.s1).toBeDefined())
  })

  it('un 409 no deja aviso ni cambia nada', async () => {
    install()
    open()
    fetchMock.mockImplementation(async () => json({ motivo: 'ocupada', message: 'ocupada' }, 409))
    const r = await st().rewindTo('s1', 'm1', 'codigo', [])
    expect(r).toMatchObject({ ok: false, kind: 'conflict', motivo: 'ocupada' })
    expect(st().rewindNotices).toEqual({})
  })

  it('«Deshacer» (unrevert) con aviso deshacible usa la ruta nueva y deja el aviso de deshecho', async () => {
    const { unrevert } = install()
    open()
    useCode.setState({
      rewindSupport: { s1: true },
      rewindNotices: {
        s1: { kind: 'done', modo: 'codigo', restaurados: 1, borrados: 0, mensajesOcultos: 0, omitidos: [], puedeDeshacer: true }
      }
    })
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'POST' ? json({ restaurados: ['a.ts'], borrados: [], omitidos: [], conflictos: ['b.ts'] }) : json([])
    )
    await st().unrevert()
    const post = fetchMock.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === 'POST')!
    expect(new URL(post[0] as string).pathname).toBe('/experimental/session/s1/rebobinar/deshacer')
    expect(unrevert).not.toHaveBeenCalled()
    expect(st().rewindNotices.s1).toMatchObject({ kind: 'undone', restaurados: 1, puedeDeshacer: false })
    expect(st().rewindNotices.s1.omitidos).toEqual([{ file: 'b.ts', motivo: 'conflicto' }])
  })

  it('«nada que deshacer» o 404 en deshacer: cae al unrevert de siempre', async () => {
    const { unrevert } = install()
    open()
    useCode.setState({
      rewindSupport: { s1: true },
      rewindNotices: {
        s1: { kind: 'done', modo: 'todo', restaurados: 0, borrados: 0, mensajesOcultos: 2, omitidos: [], puedeDeshacer: true }
      }
    })
    fetchMock.mockImplementation(async () => json({ motivo: 'nada-que-deshacer', message: 'x' }, 409))
    await st().unrevert()
    expect(unrevert).toHaveBeenCalledTimes(1)
    expect(st().rewindNotices.s1.puedeDeshacer).toBe(false)
  })

  it('sin aviso de rebobinado, unrevert es el de siempre (sin tocar las rutas nuevas)', async () => {
    const { unrevert } = install()
    open()
    await st().unrevert()
    expect(unrevert).toHaveBeenCalledTimes(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un error real al deshacer queda en globalError y NO cae al unrevert', async () => {
    const { unrevert } = install()
    open()
    useCode.setState({
      rewindSupport: { s1: true },
      rewindNotices: {
        s1: { kind: 'done', modo: 'todo', restaurados: 0, borrados: 0, mensajesOcultos: 2, omitidos: [], puedeDeshacer: true }
      }
    })
    fetchMock.mockImplementation(async () => json({}, 500))
    await st().unrevert()
    expect(unrevert).not.toHaveBeenCalled()
    expect(st().globalError).toBeTruthy()
  })

  it('markRewindUnavailable apaga el soporte y cierra el diálogo; borrar la sesión limpia todo', async () => {
    install()
    open()
    useCode.setState({ rewindSupport: { s1: true }, rewindDialog: { sessionID: 's1', messageID: 'm1' } })
    st().markRewindUnavailable('s1')
    expect(st().rewindSupport.s1).toBe(false)
    expect(st().rewindDialog).toBeNull()
    useCode.setState({
      turnsBySession: { s1: [] },
      rewindNotices: { s1: { kind: 'done', restaurados: 0, borrados: 0, mensajesOcultos: 0, omitidos: [], puedeDeshacer: false } }
    })
    st().applyEvent({ id: 'e_del', type: 'session.deleted', properties: { info: makeSession('s1', D) } } as unknown as OcEvent, D)
    expect(st().turnsBySession).toEqual({})
    expect(st().rewindNotices).toEqual({})
  })
})
