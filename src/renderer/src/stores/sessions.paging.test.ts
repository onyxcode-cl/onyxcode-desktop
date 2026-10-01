/** M12: la lista de sesiones no se corta en 200; «Cargar más» y «todas» traen el resto. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../lib/opencode'
import { makeSession } from '../../../test/fixtures/events'

type Mod = typeof import('./sessions')
let m: Mod
const D = '/proj'
const ALL = Array.from({ length: 250 }, (_, i) => makeSession(`ses_${String(i).padStart(3, '0')}`, D))

/** Servidor falso: respeta `limit`. */
function fakeClient(): { client: OpencodeClient; limits: number[] } {
  const limits: number[] = []
  const list = vi.fn(async (q: { limit: number }) => {
    limits.push(q.limit)
    return { data: ALL.slice(0, q.limit) }
  })
  return { client: { session: { list } } as unknown as OpencodeClient, limits }
}

beforeEach(async () => {
  vi.resetModules()
  m = await import('./sessions')
})

describe('paginación de sesiones (M12)', () => {
  it('con 250 sesiones carga 200 y avisa de que hay más', async () => {
    const { client } = fakeClient()
    await m.useSessions.getState().loadSessions(client, D)
    expect(Object.keys(m.useSessions.getState().sessions)).toHaveLength(200)
    expect(m.useSessions.getState().moreSessions[m.sessionsKey(D)]).toBe(true)
  })
  it('«Cargar más» trae las 250 y ya no hay más', async () => {
    const { client, limits } = fakeClient()
    await m.useSessions.getState().loadSessions(client, D)
    await m.useSessions.getState().loadMoreSessions(client, D)
    expect(Object.keys(m.useSessions.getState().sessions)).toHaveLength(250)
    expect(m.useSessions.getState().moreSessions[m.sessionsKey(D)]).toBe(false)
    expect(limits).toEqual([200, 400])
  })
  it('«todas» (filtro) trae todas de una vez', async () => {
    const { client } = fakeClient()
    await m.useSessions.getState().loadSessions(client, D)
    await m.useSessions.getState().loadMoreSessions(client, D, undefined, true)
    expect(Object.keys(m.useSessions.getState().sessions)).toHaveLength(250)
  })
})
