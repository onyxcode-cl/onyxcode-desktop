/** Modo unificado, índice de chats: sincronización con tope, quitar, fusión, nombres y abrir un chat de otra carpeta. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const h = vi.hoisted(() => ({
  cw: vi.fn(),
  connectFolder: vi.fn(async (_f: string, _full?: boolean): Promise<void> => undefined),
  openTask: vi.fn(async (_id: string): Promise<void> => undefined)
}))
vi.mock('./bridge', async (orig) => ({ ...(await orig<typeof import('./bridge')>()), cw: h.cw }))
vi.mock('./store', async (orig) => ({ ...(await orig<typeof import('./store')>()), connectFolder: h.connectFolder }))
vi.mock('./actions', async (orig) => ({ ...(await orig<typeof import('./actions')>()), openTask: h.openTask }))

import {
  CHAT_INDEX_THROTTLE_MS,
  chatDisplayTitle,
  forgetChatSession,
  loadChatIndex,
  resetChatIndexSync,
  syncChatSession,
  useChatIndex,
  visibleEntries
} from './chatIndex'
import { openIndexedChat } from './chatIndexOpen'
import { useTasks } from './store'

const F = '/Users/x/Lazunox/Chats/20261027-abc123'
const entry = (over: Partial<{ folder: string; sessionId: string; title: string; updatedAt: number }> = {}) => ({
  folder: F,
  sessionId: 'ses_1',
  title: 'Hola',
  updatedAt: 1000,
  ...over
})
const upserts = (): unknown[] => h.cw.mock.calls.filter((c) => c[0] === 'tasks:chatIndex:upsert').map((c) => c[1])

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 9, 27, 12, 0, 0))
  h.cw.mockReset()
  h.cw.mockResolvedValue(undefined)
  h.connectFolder.mockClear()
  h.openTask.mockClear()
  resetChatIndexSync()
  useTasks.setState({ folder: null, phase: 'idle', fullAccess: false } as never)
})
afterEach(() => vi.useRealTimers())

describe('sincronización renderer → main', () => {
  it('avisa al ver una sesión, con la ruta real, título y actividad', () => {
    syncChatSession(entry())
    expect(upserts()).toEqual([entry()])
  })
  it('misma sesión sin cambios: no repite; con cambios dentro del tope: una sola llamada al final con lo último', () => {
    syncChatSession(entry())
    syncChatSession(entry())
    syncChatSession(entry({ updatedAt: 2000 }))
    syncChatSession(entry({ updatedAt: 3000, title: 'Nuevo título' }))
    expect(upserts()).toHaveLength(1)
    vi.advanceTimersByTime(CHAT_INDEX_THROTTLE_MS + 10)
    expect(upserts()).toHaveLength(2)
    expect(upserts()[1]).toEqual(entry({ updatedAt: 3000, title: 'Nuevo título' }))
  })
  it('otra sesión no espera a la primera', () => {
    syncChatSession(entry())
    syncChatSession(entry({ sessionId: 'ses_2' }))
    expect(upserts()).toHaveLength(2)
  })
  it('si el canal rechaza, falla en silencio (log) y no lanza', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    h.cw.mockRejectedValue(new Error('INVALID'))
    expect(() => syncChatSession(entry())).not.toThrow()
    await vi.advanceTimersByTimeAsync(0)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
  it('recorta títulos de más de 300 caracteres', () => {
    syncChatSession(entry({ title: 'x'.repeat(500) }))
    expect((upserts()[0] as { title: string }).title).toHaveLength(300)
  })
  it('remove: llama al canal, saca la entrada local y cancela lo pendiente', () => {
    syncChatSession(entry())
    syncChatSession(entry({ updatedAt: 5000 }))
    forgetChatSession(F, 'ses_1')
    expect(h.cw).toHaveBeenCalledWith('tasks:chatIndex:remove', { folder: F, sessionId: 'ses_1' })
    expect(useChatIndex.getState().entries).toEqual([])
    vi.advanceTimersByTime(CHAT_INDEX_THROTTLE_MS * 2)
    expect(upserts()).toHaveLength(1)
  })
})

describe('lista', () => {
  it('carga el índice de main; un fallo conserva la copia', async () => {
    h.cw.mockResolvedValueOnce([entry(), entry({ sessionId: 'ses_2', folder: '/a/b' })])
    await loadChatIndex()
    expect(useChatIndex.getState().entries).toHaveLength(2)
    h.cw.mockRejectedValueOnce(new Error('x'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await loadChatIndex()
    warn.mockRestore()
    expect(useChatIndex.getState().entries).toHaveLength(2)
  })
  it('fusiona: la conectada manda por sessionId, ordena por actividad y no descarta por carpeta mientras carga', () => {
    const es = [
      entry({ sessionId: 'a', updatedAt: 10, folder: '/f1' }),
      entry({ sessionId: 'b', updatedAt: 30, folder: '/f2' }),
      entry({ sessionId: 'c', updatedAt: 20, folder: '/conn' })
    ]
    const base = { connectedFolder: '/conn', knownIds: new Set(['a']) }
    expect(visibleEntries(es, { ...base, connectedSettled: false }).map((e) => e.sessionId)).toEqual(['b', 'c'])
    expect(visibleEntries(es, { ...base, connectedSettled: true }).map((e) => e.sessionId)).toEqual(['b'])
  })
})

describe('nombres', () => {
  it('título propio; sin título «Chat sin título · fecha»; el servidor sin título propio también; nunca el id', () => {
    expect(chatDisplayTitle('  Mi chat ', 1)).toBe('Mi chat')
    const ts = new Date(2026, 9, 27).getTime()
    for (const empty of ['', '   ', undefined, null, 'New session - 2026-10-27T10:00:00.000Z']) {
      const name = chatDisplayTitle(empty, ts)
      expect(name).toMatch(/^Chat sin título · /)
      expect(name).not.toContain('2026-10-27T')
    }
  })
})

describe('abrir un chat de otra carpeta', () => {
  it('carpeta no conectada: connectFolder(path, false) y luego abre la sesión', async () => {
    h.connectFolder.mockImplementation(async (f: string) => {
      useTasks.setState({ folder: f, phase: 'ready', fullAccess: false } as never)
    })
    await expect(openIndexedChat(entry({ sessionId: 'ses_9' }))).resolves.toBe(true)
    expect(h.connectFolder).toHaveBeenCalledWith(F, false)
    expect(h.openTask).toHaveBeenCalledWith('ses_9')
    expect(h.connectFolder.mock.invocationCallOrder[0]).toBeLessThan(h.openTask.mock.invocationCallOrder[0])
    expect(useChatIndex.getState().opening).toBeNull()
  })
  it('ya conectada: no reconecta', async () => {
    useTasks.setState({ folder: F, phase: 'ready', fullAccess: false } as never)
    await openIndexedChat(entry())
    expect(h.connectFolder).not.toHaveBeenCalled()
    expect(h.openTask).toHaveBeenCalled()
  })
  it('conectada pero con Control total: reconecta sin él, nunca con fullAccess:true', async () => {
    useTasks.setState({ folder: F, phase: 'ready', fullAccess: true, conn: { fullAccess: true } } as never)
    h.connectFolder.mockImplementation(async (f: string) => {
      useTasks.setState({ folder: f, phase: 'ready', fullAccess: false } as never)
    })
    await openIndexedChat(entry())
    expect(h.connectFolder).toHaveBeenCalledWith(F, false)
  })
  it('error de conexión: mensaje en español, no abre y la lista se conserva', async () => {
    useChatIndex.setState({ entries: [entry(), entry({ sessionId: 'z' })] })
    h.connectFolder.mockImplementation(async (f: string) => {
      useTasks.setState({ folder: f, phase: 'error' } as never)
    })
    await expect(openIndexedChat(entry())).resolves.toBe(false)
    expect(h.openTask).not.toHaveBeenCalled()
    expect(useChatIndex.getState().error).toContain('No se pudo abrir ese chat')
    expect(useChatIndex.getState().entries).toHaveLength(2)
    expect(useChatIndex.getState().opening).toBeNull()
  })
})
