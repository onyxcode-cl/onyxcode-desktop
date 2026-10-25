/**
 * «Compactar hasta aquí» en el store de Code: manda modelo + `upTo` por `fetch` crudo, solo con el motor propio nuevo y en el Mac, se
 * niega sin ir al motor cuando ya se sabe que respondería 409, y traduce los fallos del motor a un aviso claro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, type TraceEvent } from '../../../../../test/fixtures/events'
import type { OcEvent } from '../../../lib/opencode'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let compactBlockOf: Store['compactBlockOf']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'
const fetchMock = vi.fn()
const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status })

beforeEach(async () => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  resetEventIds()
  ;({ useCode, compactBlockOf } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useServer.setState({
    client: {} as never,
    connection: { baseUrl: 'http://127.0.0.1:4999', authorization: 'Basic abc', chatDirectory: '/chat' } as never
  })
  const te: TraceEvent = sessionCreated(makeSession('s1', D))
  useCode.setState({ directory: D })
  st().applyEvent(te.event as OcEvent, te.directory)
  useCode.setState({
    activeSessionID: 's1',
    sessionProject: { s1: D },
    rewindSupport: { s1: true },
    model: { providerID: 'opencode', modelID: 'free' }
  })
})

describe('compactUpTo', () => {
  it('manda providerID, modelID y upTo a summarize y deja la sesión ocupada', async () => {
    fetchMock.mockImplementation(async () => json(true))
    expect(await st().compactUpTo('s1', 'msg_3')).toBe(true)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/session/s1/summarize')
    expect(url).toContain('directory=%2Fwork%2Fcode')
    expect(JSON.parse(init.body as string)).toEqual({ providerID: 'opencode', modelID: 'free', upTo: 'msg_3' })
    expect(st().runState.s1).toBe('busy')
  })

  it('sin soporte del motor nuevo (o en el celular) no llama: un motor viejo ignoraría upTo y compactaría todo', async () => {
    useCode.setState({ rewindSupport: { s1: false } })
    expect(await st().compactUpTo('s1', 'msg_3')).toBe(false)
    useCode.setState({ rewindSupport: {} })
    expect(await st().compactUpTo('s1', 'msg_3')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sesión ocupada, revert pendiente o permiso pendiente: ni va al motor y dice por qué', async () => {
    useCode.setState({ runState: { s1: 'busy' } })
    expect(await st().compactUpTo('s1', 'msg_3')).toBe(false)
    expect(st().globalError).toContain('mientras la conversación trabaja')
    useCode.setState({ runState: { s1: 'idle' }, globalError: null })
    useCode.setState({
      permissions: { p1: { id: 'p1', sessionID: 's1', permission: 'bash', patterns: [], metadata: {}, always: [] } as never }
    })
    expect(await st().compactUpTo('s1', 'msg_3')).toBe(false)
    expect(st().globalError).toContain('Responde antes')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('traduce el 409 y el 400 del motor y deja la sesión libre', async () => {
    fetchMock.mockImplementationOnce(async () => json({ motivo: 'revert' }, 409))
    expect(await st().compactUpTo('s1', 'msg_3')).toBe(false)
    expect(st().globalError).toContain('cambios deshechos')
    expect(st().runState.s1).toBe('idle')
    fetchMock.mockImplementationOnce(async () => json({ field: 'upTo', kind: 'cola-grande' }, 400))
    expect(await st().compactUpTo('s1', 'msg_3')).toBe(false)
    expect(st().globalError).toContain('ya no cabe')
    fetchMock.mockImplementationOnce(async () => json({}, 500))
    expect(await st().compactUpTo('s1', 'msg_3')).toBe(false)
    expect(st().globalError).toContain('500')
  })
})

describe('compactBlockOf', () => {
  it('un permiso de una hija bloquea a la madre; sin nada pendiente no hay bloqueo', () => {
    const base = {
      sessions: { s1: { id: 's1' }, kid: { id: 'kid', parentID: 's1' } } as never,
      runState: {},
      permissions: {},
      questions: {},
      elicitations: {}
    }
    expect(compactBlockOf(base, 's1')).toBeNull()
    expect(compactBlockOf({ ...base, permissions: { p: { id: 'p', sessionID: 'kid' } as never } }, 's1')).toBe('pendiente')
    expect(compactBlockOf({ ...base, runState: { s1: 'retry' } }, 's1')).toBe('ocupada')
    expect(compactBlockOf({ ...base, sessions: { s1: { id: 's1', revert: { messageID: 'm' } } } as never }, 's1')).toBe('revert')
  })
})
