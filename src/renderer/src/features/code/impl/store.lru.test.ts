/**
 * LRU de `useCode.messages` (docs/LRU-PLAN.md, paso 6, F6-B16).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import {
  assistantMessage,
  makeSession,
  msgUpdated,
  partDelta,
  permAsked,
  resetEventIds,
  sessionCreated,
  statusBusy,
  statusIdle,
  textPart,
  userMessage,
  type TraceEvent
} from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let isCodeTranscriptLoading: Store['isCodeTranscriptLoading']
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode, isCodeTranscriptLoading } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const apply = (te: TraceEvent): void => st().applyEvent(te.event, te.directory)
const m_isLoading = (sid: string): boolean => isCodeTranscriptLoading(useCode.getState(), sid)
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const keys = (): string[] => Object.keys(st().messages).sort()
const lruOn = (max: number): void => {
  localStorage.setItem('onyx.lru.max', String(max))
}
/** Sesión conocida con un mensaje (contenido) recibido por eventos. */
function seed(id: string, extra: Partial<Session> = {}): void {
  apply(sessionCreated(makeSession(id, D, extra)))
  apply(msgUpdated(userMessage(`msg_${id}`, id), D))
}

type Snap = { data: { info: unknown; parts: unknown[] }[] }
function installClient(messages: (sid: string) => Promise<Snap> = () => Promise.resolve({ data: [] })): {
  promptAsync: ReturnType<typeof vi.fn>
  calls: string[]
} {
  const calls: string[] = []
  const promptAsync = vi.fn(() => Promise.resolve({ data: {} }))
  const client = {
    session: {
      list: () => Promise.resolve({ data: [] }),
      status: () => Promise.resolve({ data: {} }),
      messages: ({ sessionID }: { sessionID: string }) => {
        calls.push(sessionID)
        return messages(sessionID)
      },
      todo: () => Promise.resolve({ data: [] }),
      promptAsync
    },
    permission: { list: () => Promise.resolve({ data: [] }) },
    question: { list: () => Promise.resolve({ data: [] }) }
  }
  useServer.setState({ client: client as never })
  return { promptAsync, calls }
}
const snap = (sid: string, text: string): Snap => ({
  data: [{ info: assistantMessage(`msg_${sid}`, sid), parts: [textPart(`prt_${sid}`, `msg_${sid}`, sid, text)] }]
})

describe('LRU de Code: desalojo', () => {
  it('el tope por defecto es 20 y se desaloja la menos reciente', async () => {
    installClient()
    for (let i = 0; i < 22; i++) seed(`s${String(i).padStart(2, '0')}`)
    await st().selectSession('s21')
    // 22 con contenido: la activa (s21) está fijada, así que sobran 21 - 20 = 1 (la nunca abierta más antigua)
    expect(keys()).toHaveLength(21)
    expect(st().messages['s00']).toBeUndefined()
    expect(st().messages['s21']).toBeDefined()
  })

  it('un solo set limpia messages y loadingMessages; touch sin exceso no hace set', async () => {
    lruOn(1)
    installClient()
    seed('a')
    seed('b')
    await st().selectSession('a')
    await st().selectSession('b') // activa b; sin exceso (solo a sin fijar)
    // c y d con contenido sin pasar por eventos (no programan desalojo)
    useCode.setState((s) => ({ messages: { ...s.messages, c: [], d: [] }, loadingMessages: { ...s.loadingMessages, a: false } }))
    let sets = 0
    const unsub = useCode.subscribe(() => sets++)
    st().touchSession('d') // sin fijar: a, c, d → sobran 2: c (nunca abierta) y a (la más antigua)
    unsub()
    expect(sets).toBe(1)
    expect(keys()).toEqual(['b', 'd'])
    expect('a' in st().loadingMessages).toBe(false)
    expect(st().sessions['a']).toBeDefined() // solo el contenido
    let more = 0
    const unsub2 = useCode.subscribe(() => more++)
    st().touchSession('d')
    unsub2()
    expect(more).toBe(0)
  })

  it('nunca desaloja la activa, busy, cola no vacía, permiso pendiente ni sus raíces/hijas', async () => {
    lruOn(1)
    installClient()
    for (const id of ['idle1', 'idle2', 'idle3', 'busy', 'queued', 'perm', 'root']) seed(id)
    seed('kid', { parentID: 'root' })
    apply(statusBusy('busy', D))
    st().enqueue('queued', 'luego')
    apply(permAsked({ id: 'per_1', sessionID: 'perm' }, D))
    useCode.setState({ activeSessionID: 'idle1' })
    // permiso pendiente en la hija 'kid': fija también a su raíz 'root'
    apply(permAsked({ id: 'per_2', sessionID: 'kid' }, D))
    st().touchSession('idle3')
    expect(keys()).toEqual(['busy', 'idle1', 'idle3', 'kid', 'perm', 'queued', 'root'])
  })

  it('las nunca abiertas salen primero y el orden sigue lastAccess', async () => {
    lruOn(2)
    installClient()
    for (const id of ['a', 'b', 'c', 'd']) seed(id)
    await st().selectSession('c')
    await st().selectSession('b')
    await st().selectSession('a') // a activa; b (2º) y c (1º) por acceso; d nunca
    expect(keys()).toEqual(['a', 'b', 'c']) // d desalojada primero; 3 = activa + tope 2
  })

  it('un evento no cuenta como acceso y los nuevos por eventos se desalojan agrupados por microtask', async () => {
    lruOn(1)
    installClient()
    seed('a')
    seed('b')
    await st().selectSession('a')
    await st().selectSession('b')
    let sets = 0
    const unsub = useCode.subscribe(() => sets++)
    for (const id of ['r1', 'r2', 'r3']) seed(id) // sesión + mensaje: 3 claves nuevas en el mismo tick
    const afterSeed = sets
    expect(keys()).toHaveLength(5)
    await flush()
    unsub()
    expect(sets - afterSeed).toBe(1)
    expect(keys()).toEqual(['a', 'b']) // b activa; las de eventos (nunca abiertas) salen antes que a (abierta)
  })

  it('cargar mensajes cuenta como acceso (no sale desalojada al terminar)', async () => {
    lruOn(1)
    installClient()
    seed('a')
    seed('b')
    seed('c')
    useCode.setState({ activeSessionID: 'b' })
    await st().resync() // recarga la activa (b)
    await flush()
    expect(st().messages['b']).toBeDefined()
  })

  it('cola: encolar en A, pasar a B/C/D y A se autoenvía al quedar libre', async () => {
    lruOn(1)
    const { promptAsync } = installClient()
    for (const id of ['A', 'B', 'C', 'D']) seed(id)
    apply(statusBusy('A', D))
    st().enqueue('A', 'siguiente')
    for (const id of ['B', 'C', 'D']) await st().selectSession(id)
    expect(st().messages['A']).toBeDefined() // cola no vacía y busy: fijada
    apply(statusIdle('A', D))
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(st().queue['A']).toEqual([])
  })

  it('olvida las partes huérfanas de la sesión desalojada', async () => {
    lruOn(1)
    installClient()
    seed('a')
    seed('b')
    seed('c')
    apply({
      event: {
        id: 'orph',
        type: 'message.part.updated',
        properties: { sessionID: 'a', part: textPart('p1', 'msg_x', 'a', 'x'), time: 1 }
      } as never,
      directory: D
    })
    await st().selectSession('c')
    await st().selectSession('b')
    expect(st().messages['a']).toBeUndefined()
    apply(msgUpdated(assistantMessage('msg_x', 'a'), D)) // llega el mensaje: la parte huérfana ya no se adopta
    expect(st().messages['a'][0].parts).toEqual([])
  })
})

describe('LRU de Code: desalojo + delta en vuelo + reapertura', () => {
  it('reabrir vuelve a llamar a session.messages y fusiona el delta en vuelo sin pérdida ni duplicado', async () => {
    lruOn(1)
    let release!: (v: Snap) => void
    let hold = false
    const { calls } = installClient((sid) => {
      if (sid === 'A' && hold) return new Promise<Snap>((r) => (release = r))
      return Promise.resolve(snap(sid, 'Hel'))
    })
    seed('A')
    seed('B')
    seed('C')
    await st().selectSession('A')
    await st().selectSession('B')
    await st().selectSession('C') // activa C; A y B sin fijar: sobra la más antigua (A)
    expect(st().messages['A']).toBeUndefined()
    const before = calls.filter((c) => c === 'A').length

    hold = true
    const reopening = st().selectSession('A') // fija (activa + touch) y carga
    expect(calls.filter((c) => c === 'A').length).toBe(before + 1)
    expect(st().loadingMessages['A']).toBe(true)
    apply(partDelta({ sessionID: 'A', messageID: 'msg_A', partID: 'prt_A', delta: 'lo' }, D)) // delta en vuelo
    apply(msgUpdated(userMessage('msg_late', 'A'), D)) // mensaje nuevo en vuelo
    await flush() // un desalojo a mitad de carga no toca a A
    expect(st().loadingMessages['A']).toBe(true)
    release(snap('A', 'Hel'))
    await reopening
    const list = st().messages['A']
    expect(list.map((e) => e.info.id)).toEqual(['msg_A', 'msg_late'])
    expect((list[0].parts[0] as { text: string }).text).toBe('Hello')
  })
})

describe('B5: loader al reabrir una sesión desalojada (isCodeTranscriptLoading)', () => {
  it('sesión desalojada seleccionada no muestra vacío', async () => {
    lruOn(1)
    let release: (v: Snap) => void = () => undefined
    installClient((sid) => (sid === 'a' ? new Promise<Snap>((r) => (release = r)) : Promise.resolve(snap(sid, 'x'))))
    seed('a')
    seed('b')
    seed('c')
    await st().selectSession('b')
    await st().selectSession('c') // tope 1: a (nunca abierta) queda desalojada
    await flush()
    expect(st().messages['a']).toBeUndefined()
    expect(st().sessions['a']).toBeDefined()

    const pending = st().selectSession('a') // reabrir: activa + carga en vuelo
    expect(st().activeSessionID).toBe('a')
    expect(st().messages['a']).toBeUndefined()
    expect(m_isLoading('a')).toBe(true) // en vez de EmptySession/spinner pelado
    release(snap('a', 'de vuelta'))
    await pending
    expect(st().messages['a']).toBeDefined()
    expect(m_isLoading('a')).toBe(false)
  })

  it('falso sin sesión, sin carga en curso, con historial ya presente o con sesión desconocida', () => {
    const base = {
      sessions: { a: makeSession('a', D) },
      messages: {} as Record<string, unknown[]>,
      loadingMessages: {} as Record<string, boolean>
    }
    const f = (over: Partial<typeof base>, sid: string | null): boolean => isCodeTranscriptLoading({ ...base, ...over } as never, sid)
    expect(f({ loadingMessages: { a: true } }, 'a')).toBe(true)
    expect(f({}, 'a')).toBe(false) // sesión nueva vacía: nada que cargar
    expect(f({ loadingMessages: { a: true }, messages: { a: [] } }, 'a')).toBe(false) // recarga con historial presente
    expect(f({ loadingMessages: { z: true } }, 'z')).toBe(false) // desconocida
    expect(f({ loadingMessages: { a: true } }, null)).toBe(false)
  })
})
