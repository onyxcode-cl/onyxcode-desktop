/**
 * LRU de `useSessions.messages` (docs/LRU-PLAN.md, paso 4).
 * `vi.resetModules` deja el módulo sin guardas: cada test registra las suyas (Chat/Tareas se registran al importarse).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../lib/opencode'
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  resetEventIds,
  textPart,
  userMessage
} from '../../../test/fixtures/events'

type Mod = typeof import('./sessions')
let m: Mod
const D = '/proj'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  m = await import('./sessions')
})

const st = (): ReturnType<Mod['useSessions']['getState']> => m.useSessions.getState()
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const lruOn = (max: number): void => {
  localStorage.setItem('onyx.lru.max', String(max))
}
/** Sesión con contenido y historial cargado, vía eventos + `loaded`. */
function seed(id: string, over: { parentID?: string } = {}): void {
  st().upsertSession(makeSession(id, D, over))
  st().applyEvent(msgUpdated(userMessage(`msg_${id}`, id), D).event)
  m.useSessions.setState((s) => ({ loaded: { ...s.loaded, [id]: true } }))
}
const keys = (): string[] => Object.keys(st().messages).sort()
function fakeClient(messages: () => Promise<{ data: { info: unknown; parts: unknown[] }[] }>): OpencodeClient {
  return { session: { messages } } as unknown as OpencodeClient
}
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('LRU de messages: desalojo', () => {
  it('desaloja la menos reciente y limpia messages, loaded y loadingMessages en UN solo set', () => {
    lruOn(2)
    for (const id of ['a', 'b']) seed(id)
    st().touchSession('a')
    st().touchSession('b')
    m.useSessions.setState((s) => ({ loadingMessages: { ...s.loadingMessages, a: false } }))
    seed('c')
    let sets = 0
    const unsub = m.useSessions.subscribe(() => sets++)
    st().touchSession('c') // a es la más antigua
    unsub()
    expect(sets).toBe(1)
    expect(keys()).toEqual(['b', 'c'])
    expect(st().loaded).toEqual({ b: true, c: true })
    expect('a' in st().loadingMessages).toBe(false)
    expect(st().sessions['a']).toBeDefined() // solo el contenido
  })

  it('touch no hace set si no hay nada que desalojar', () => {
    lruOn(5)
    seed('a')
    let sets = 0
    const unsub = m.useSessions.subscribe(() => sets++)
    st().touchSession('a')
    unsub()
    expect(sets).toBe(0)
  })

  it('las nunca abiertas salen primero', () => {
    lruOn(2)
    seed('opened1')
    seed('never')
    seed('opened2')
    st().touchSession('opened1')
    st().touchSession('opened2')
    expect(keys()).toEqual(['opened1', 'opened2'])
  })

  it('nunca desaloja busy/retry, cargas en vuelo ni guardas, ni su raíz o hijas', () => {
    lruOn(1)
    m.useSessions.setState({ status: { busy1: 'busy', retry1: 'retry' } })
    seed('busy1')
    seed('retry1')
    seed('guarded')
    seed('kid', { parentID: 'guarded' })
    seed('root')
    seed('child', { parentID: 'root' })
    seed('idle1')
    seed('idle2')
    st().addEvictionGuard(() => ['child'])
    st().addEvictionGuard(() => ['guarded'])
    st().touchSession('idle2')
    // fijadas: busy1, retry1, guarded(+kid), child(+root); el tope de 1 se aplica al resto
    expect(keys()).toEqual(['busy1', 'child', 'guarded', 'idle2', 'kid', 'retry1', 'root'])
  })

  it('una guarda que lanza no desaloja nada', () => {
    lruOn(1)
    seed('a')
    seed('b')
    st().addEvictionGuard(() => {
      throw new Error('boom')
    })
    st().touchSession('b')
    expect(keys()).toEqual(['a', 'b'])
  })

  it('addEvictionGuard devuelve la baja', () => {
    lruOn(1)
    seed('a')
    seed('b')
    const off = st().addEvictionGuard(() => ['a'])
    st().touchSession('b')
    expect(keys()).toEqual(['a', 'b'])
    off()
    st().touchSession('b')
    expect(keys()).toEqual(['b'])
  })

  it('el tope se sobrescribe con localStorage y por defecto es 40', () => {
    for (let i = 0; i < 41; i++) seed(`s${String(i).padStart(2, '0')}`)
    st().touchSession('s40')
    expect(keys()).toHaveLength(40)
    expect(st().messages['s00']).toBeUndefined() // nunca abierta: sale primero
  })

  it('olvida las partes huérfanas de la sesión desalojada', () => {
    lruOn(1)
    seed('a')
    seed('b')
    // parte huérfana de 'a' (mensaje desconocido) y de 'b'
    st().applyEvent(partUpdated(textPart('p1', 'msg_x', 'a', 'x'), D).event)
    st().applyEvent(partUpdated(textPart('p2', 'msg_y', 'b', 'y'), D).event)
    st().touchSession('b')
    expect(keys()).toEqual(['b'])
    // llega el mensaje de 'a': la parte huérfana ya no se adopta
    st().applyEvent(msgUpdated(assistantMessage('msg_x', 'a'), D).event)
    expect(st().messages['a'][0].parts).toEqual([])
    st().applyEvent(msgUpdated(assistantMessage('msg_y', 'b'), D).event)
    expect(st().messages['b'].find((e) => e.info.id === 'msg_y')?.parts).toHaveLength(1)
  })

  it('removeSession olvida el acceso', () => {
    lruOn(1)
    seed('a')
    st().touchSession('a')
    st().removeSession('a')
    seed('a')
    seed('b')
    st().touchSession('b')
    expect(keys()).toEqual(['b']) // 'a' vuelve a ser "nunca abierta"
  })
})

describe('LRU de messages: eventos (F6-B15)', () => {
  it('un evento no cuenta como acceso y varios eventos del mismo tick producen un solo desalojo', async () => {
    lruOn(2)
    seed('a')
    seed('b')
    st().touchSession('a')
    st().touchSession('b')
    let sets = 0
    const unsub = m.useSessions.subscribe(() => sets++)
    const before = sets
    // tres sesiones nuevas por eventos (rutinas en segundo plano) en el mismo tick
    for (const id of ['r1', 'r2', 'r3']) st().applyEvent(msgUpdated(userMessage(`msg_${id}`, id), D).event)
    const afterEvents = sets - before // un set por evento
    expect(afterEvents).toBe(3)
    expect(keys()).toHaveLength(5) // aún no se desaloja: es por microtask
    await flush()
    unsub()
    expect(sets - before - afterEvents).toBe(1)
    // las de eventos (lastAccess 0) salen antes que las abiertas
    expect(keys()).toEqual(['a', 'b'])
  })

  it('una sesión busy que recibe eventos no se desaloja', async () => {
    lruOn(1)
    m.useSessions.setState({ status: { live: 'busy' } })
    seed('a')
    st().applyEvent(msgUpdated(assistantMessage('msg_live', 'live'), D).event)
    st().applyEvent(msgUpdated(userMessage('msg_z', 'z'), D).event)
    await flush()
    expect(keys()).toContain('live')
  })
})

describe('LRU de messages: desalojo + delta en vuelo + reapertura', () => {
  const snapshot = (text: string): { data: { info: unknown; parts: unknown[] }[] } => ({
    data: [{ info: assistantMessage('msg_1', 'A'), parts: [textPart('prt_1', 'msg_1', 'A', text)] }]
  })

  it('reabrir recarga y fusiona el delta llegado durante la carga sin pérdida ni duplicado', async () => {
    lruOn(1)
    // A cargada por el camino normal
    await st().loadMessages(
      fakeClient(() => Promise.resolve(snapshot('Hel'))),
      'A',
      D
    )
    expect(st().loaded['A']).toBe(true)
    // B lo desaloja (A idle, B más reciente)
    seed('B')
    st().touchSession('B')
    expect(st().messages['A']).toBeUndefined()
    expect(st().loaded['A']).toBeUndefined()

    // reabrir A: fijar (activa + touch) ANTES de cargar
    let active = 'A'
    st().addEvictionGuard(() => [active])
    st().touchSession('A')
    const d = deferred<ReturnType<typeof snapshot>>()
    const calls = vi.fn(() => d.promise)
    const load = st().loadMessages(fakeClient(calls), 'A', D)
    expect(calls).toHaveBeenCalledTimes(1)
    expect(st().loadingMessages['A']).toBe(true)

    // durante la carga: un delta sobre una parte que el snapshot ya incluirá, y un mensaje nuevo
    st().applyEvent(partDelta({ sessionID: 'A', messageID: 'msg_1', partID: 'prt_1', delta: 'lo' }, D).event)
    st().applyEvent(msgUpdated(userMessage('msg_2', 'A'), D).event)
    // un desalojo a mitad de carga no toca a A (carga en vuelo); aunque deje de ser la activa
    active = 'B'
    st().touchSession('B')
    expect(st().loadingMessages['A']).toBe(true)
    expect(st().messages['A']?.map((e) => e.info.id)).toEqual(['msg_2'])

    d.resolve(snapshot('Hel'))
    await load
    const list = st().messages['A']
    expect(list.map((e) => e.info.id)).toEqual(['msg_1', 'msg_2'])
    expect((list[0].parts[0] as { text: string }).text).toBe('Hello') // ni perdido ni duplicado
    expect(st().loaded['A']).toBe(true)
    expect(st().loadingMessages['A']).toBe(false)
  })

  it('si el snapshot ya incluía el delta, no se duplica', async () => {
    lruOn(1)
    await st().loadMessages(
      fakeClient(() => Promise.resolve(snapshot('Hel'))),
      'A',
      D
    )
    seed('B')
    st().touchSession('B')
    st().touchSession('A')
    const d = deferred<ReturnType<typeof snapshot>>()
    const load = st().loadMessages(
      fakeClient(() => d.promise),
      'A',
      D
    )
    st().applyEvent(partDelta({ sessionID: 'A', messageID: 'msg_1', partID: 'prt_1', delta: 'lo' }, D).event)
    d.resolve(snapshot('Hello'))
    await load
    expect((st().messages['A'][0].parts[0] as { text: string }).text).toBe('Hello')
  })
})

describe('isTranscriptLoading (loader al reabrir)', () => {
  it('solo mientras !loaded && loadingMessages', () => {
    const s = (loaded: boolean, loading: boolean) => ({ loaded: { a: loaded }, loadingMessages: { a: loading } })
    lruOn(2)
    expect(m.isTranscriptLoading(s(false, true), 'a')).toBe(true)
    expect(m.isTranscriptLoading(s(true, true), 'a')).toBe(false) // recarga con historial ya cargado
    expect(m.isTranscriptLoading(s(false, false), 'a')).toBe(false)
    expect(m.isTranscriptLoading(s(false, true), null)).toBe(false)
    expect(m.isTranscriptLoading({ loaded: {}, loadingMessages: {} }, 'a')).toBe(false)
  })
  it('addEvictionListener recibe solo las listas cargadas que se desalojan', () => {
    lruOn(1)
    seed('a') // cargada
    st().upsertSession(makeSession('partial', D))
    st().applyEvent(msgUpdated(userMessage('msg_p', 'partial'), D).event) // parcial: sin loaded
    seed('b')
    const seen: string[][] = []
    st().addEvictionListener((ev) => seen.push(ev.map((e) => e.id)))
    st().touchSession('b')
    expect(seen).toEqual([['a']])
    expect(keys()).toEqual(['b'])
  })
})
