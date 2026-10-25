/**
 * «Compactar historial» de Code: el motor publicado hasta lazunox.9 EXIGÍA `providerID` y `modelID` en `summarize` y respondía 400 si
 * faltaban, así que el botón no hacía nada. La app manda siempre el modelo (el de la sesión o el de Code).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, type TraceEvent } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'
const apply = (te: TraceEvent): void => useCode.getState().applyEvent(te.event, te.directory)

beforeEach(async () => {
  vi.resetModules()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
})

describe('compactSession', () => {
  it('manda providerID y modelID al motor', async () => {
    const summarize = vi.fn(() => Promise.resolve({ data: true }))
    useServer.setState({ client: { session: { summarize } } as never })
    apply(sessionCreated(makeSession('root', D, { title: 'Proyecto' })))
    useCode.setState({ activeSessionID: 'root', model: { providerID: 'opencode', modelID: 'mimo-v2.6-flash-free' } })
    await useCode.getState().compactSession('root')
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summarize).toHaveBeenCalledWith({ sessionID: 'root', directory: D, providerID: 'opencode', modelID: 'mimo-v2.6-flash-free' })
  })
})
