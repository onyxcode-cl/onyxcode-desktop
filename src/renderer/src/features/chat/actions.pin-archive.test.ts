/** Fijar (local, mismo formato que `code.pinned`) y archivar/restaurar (`session.update`) en Chat. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../../lib/opencode'
import { makeSession } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const CHAT = '/data/chat-workspace'

async function setup(update: ReturnType<typeof vi.fn>) {
  const { useServer } = await import('../../stores/server')
  useServer.setState({
    client: { session: { update, delete: vi.fn(() => Promise.resolve({})) } } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never
  })
  const { useSessions } = await import('../../stores/sessions')
  const { useChat } = await import('./store')
  const actions = await import('./actions')
  return { useSessions, useChat, ...actions }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

describe('fijar', () => {
  it('alterna, guarda por carpeta en chat.pinned y sobrevive a recargar el módulo', async () => {
    const { toggleChatPin, useChat } = await setup(vi.fn())
    toggleChatPin('s1')
    toggleChatPin('s2')
    expect(useChat.getState().pinned[CHAT]).toEqual(['s1', 's2'])
    expect(JSON.parse(localStorage.getItem('chat.pinned')!)).toEqual({ [CHAT]: ['s1', 's2'] })
    toggleChatPin('s1')
    expect(useChat.getState().pinned[CHAT]).toEqual(['s2'])
    vi.resetModules()
    const again = await import('./store')
    expect(again.useChat.getState().pinned[CHAT]).toEqual(['s2'])
  })

  it('borrar una conversación la quita de las fijadas', async () => {
    const { toggleChatPin, deleteChat, useChat } = await setup(vi.fn())
    toggleChatPin('s1')
    await deleteChat('s1')
    expect(useChat.getState().pinned[CHAT]).toEqual([])
  })

  it('un localStorage corrupto no rompe', async () => {
    localStorage.setItem('chat.pinned', '{no es json')
    const { useChat } = await setup(vi.fn())
    expect(useChat.getState().pinned).toEqual({})
  })
})

describe('archivar y restaurar', () => {
  it('archiva con time.archived, actualiza la sesión y cierra la conversación abierta', async () => {
    const archivedSession = { ...makeSession('s1', CHAT), time: { created: 1, updated: 2, archived: 99 } }
    const update = vi.fn(() => Promise.resolve({ data: archivedSession }))
    const { archiveChat, useSessions, useChat } = await setup(update)
    useSessions.getState().upsertSession(makeSession('s1', CHAT))
    useChat.getState().setActive('s1')
    await archiveChat('s1')
    const arg = (update.mock.calls[0] as unknown[])[0] as { sessionID: string; directory: string; time: { archived: number } }
    expect(arg.sessionID).toBe('s1')
    expect(arg.directory).toBe(CHAT)
    expect(arg.time.archived).toBeGreaterThan(0)
    expect(useSessions.getState().sessions['s1']!.time.archived).toBe(99)
    expect(useChat.getState().activeSessionId).toBeNull()
  })

  it('restaura con archived: 0', async () => {
    const back = { ...makeSession('s1', CHAT), time: { created: 1, updated: 2 } }
    const update = vi.fn(() => Promise.resolve({ data: back }))
    const { restoreChat, useSessions } = await setup(update)
    await restoreChat('s1')
    expect(update).toHaveBeenCalledTimes(1)
    expect((update.mock.calls[0] as unknown[])[0]).toMatchObject({ time: { archived: 0 } })
    expect(useSessions.getState().sessions['s1']!.time.archived).toBeUndefined()
  })

  it('si el motor sigue devolviéndola archivada, usa el respaldo metadata.unarchivedAt', async () => {
    const still = { ...makeSession('s1', CHAT), time: { created: 1, updated: 2, archived: 50 } }
    const fixed = { ...still, metadata: { unarchivedAt: 60 } }
    const update = vi.fn().mockResolvedValueOnce({ data: still }).mockResolvedValueOnce({ data: fixed })
    const { restoreChat, useSessions } = await setup(update)
    await restoreChat('s1')
    expect(update).toHaveBeenCalledTimes(2)
    expect((update.mock.calls[1] as unknown[])[0]).toMatchObject({ metadata: { unarchivedAt: expect.any(Number) } })
    expect(useSessions.getState().sessions['s1']!.metadata).toEqual({ unarchivedAt: 60 })
  })

  it('si el motor rechaza archivar, lanza y no cambia nada', async () => {
    const update = vi.fn(() => Promise.resolve({ error: { message: 'no' } }))
    const { archiveChat, useSessions } = await setup(update)
    useSessions.getState().upsertSession(makeSession('s1', CHAT))
    await expect(archiveChat('s1')).rejects.toThrow()
    expect(useSessions.getState().sessions['s1']!.time.archived).toBeUndefined()
  })
})
