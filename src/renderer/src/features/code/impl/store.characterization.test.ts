/**
 * Tests de caracterización de `features/code/impl/store.ts` (Fase 6.0): congelan el comportamiento
 * ACTUAL, incluidos los bugs conocidos (marcados `F6-B<n>`/`Pf1`), antes de tocar los stores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import {
  assistantMessage,
  fileWatcherUpdated,
  makeSession,
  msgUpdated,
  partDelta,
  partUpdated,
  permAsked,
  resetEventIds,
  sessionCreated,
  statusBusy,
  statusIdle,
  textPart,
  userMessage,
  type TraceEvent
} from '../../../../../test/fixtures/events'

const sendNotification = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/notify', () => ({ sendNotification, setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'

beforeEach(async () => {
  vi.resetModules()
  sendNotification.mockClear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const apply = (te: TraceEvent): void => st().applyEvent(te.event, te.directory)
const open = (id: string, extra: Partial<Session> = {}): void => apply(sessionCreated(makeSession(id, D, extra)))

interface FakeOpts {
  list?: Session[]
  status?: Record<string, { type: string }>
  messages?: { info: unknown; parts: unknown[] }[]
}
function installClient(o: FakeOpts = {}): { promptAsync: ReturnType<typeof vi.fn> } {
  const promptAsync = vi.fn(() => Promise.resolve({ data: {} }))
  const client = {
    session: {
      list: () => Promise.resolve({ data: o.list ?? [] }),
      status: () => Promise.resolve({ data: o.status ?? {} }),
      messages: () => Promise.resolve({ data: o.messages ?? [] }),
      todo: () => Promise.resolve({ data: [] }),
      promptAsync
    },
    permission: { list: () => Promise.resolve({ data: [] }) },
    question: { list: () => Promise.resolve({ data: [] }) }
  }
  useServer.setState({ client: client as never })
  return { promptAsync }
}

describe('dedupe por event.id', () => {
  it('ignora eventos repetidos (un delta con el mismo id se aplica una vez)', () => {
    open('s1')
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', ''), D))
    const d = partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'ab' }, D, 'evt_dup')
    apply(d)
    apply(d)
    expect((st().messages['s1'][0].parts[0] as { text: string }).text).toBe('ab')
  })

  it('eventos con ids distintos sí se aplican todos', () => {
    open('s1')
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', ''), D))
    for (const delta of ['a', 'b', 'c']) apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta }, D))
    expect((st().messages['s1'][0].parts[0] as { text: string }).text).toBe('abc')
  })
})

describe('sesiones desconocidas', () => {
  it('descarta mensajes, partes y estado de una sesión desconocida', () => {
    apply(msgUpdated(userMessage('msg_1', 'ghost'), D))
    apply(partUpdated(textPart('prt_1', 'msg_1', 'ghost', 'x'), D))
    apply(statusBusy('ghost', D))
    expect(st().messages['ghost']).toBeUndefined()
    expect(st().runState['ghost']).toBeUndefined()
  })

  it('una sesión creada en otro directorio sin proyecto conocido se descarta', () => {
    apply(sessionCreated(makeSession('foreign', '/otro')))
    expect(st().sessions['foreign']).toBeUndefined()
  })

  it('permission.asked de sesión desconocida se adopta si viene del directorio abierto', () => {
    apply(permAsked({ id: 'per_1', sessionID: 'sub' }, D))
    expect(st().permissions['per_1']).toMatchObject({ sessionID: 'sub', permission: 'bash', api: 'v1' })
    expect(st().sessionProject['sub']).toBe(D)
    expect(st().unread['sub']).toBe(true) // no es la sesión activa
  })

  it('permission.asked de otro directorio y sesión desconocida se descarta', () => {
    apply(permAsked({ id: 'per_2', sessionID: 'sub2' }, '/otro'))
    expect(st().permissions).toEqual({})
  })

  it('question.asked sigue la misma regla de adopción', () => {
    st().applyEvent({ id: 'q1', type: 'question.asked', properties: { id: 'q_1', sessionID: 'sq', questions: [] } } as never, D)
    st().applyEvent({ id: 'q2', type: 'question.asked', properties: { id: 'q_2', sessionID: 'sq2', questions: [] } } as never, '/otro')
    expect(Object.keys(st().questions)).toEqual(['q_1'])
  })

  it('permission.replied elimina el permiso pendiente', () => {
    apply(permAsked({ id: 'per_1', sessionID: 'sub' }, D))
    st().applyEvent(
      { id: 'r1', type: 'permission.replied', properties: { sessionID: 'sub', requestID: 'per_1', reply: 'once' } } as never,
      D
    )
    expect(st().permissions).toEqual({})
  })
})

describe('session.status', () => {
  it('idle tras busy: sube fsVersion, marca unread, notifica y auto-envía la cola', () => {
    const { promptAsync } = installClient()
    open('s1', { title: 'Mi tarea' })
    st().enqueue('s1', 'siguiente', [])
    apply(statusBusy('s1', D))
    expect(st().runState['s1']).toBe('busy')
    const fs = st().fsVersion
    apply(statusIdle('s1', D))
    expect(st().fsVersion).toBe(fs + 1)
    expect(st().unread['s1']).toBe(true) // no es la sesión activa
    expect(sendNotification).toHaveBeenCalledWith('Code terminó', 'Mi tarea', { mode: 'code', id: 's1', directory: D })
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(st().queue['s1']).toEqual([])
    expect(st().runState['s1']).toBe('busy') // doSend la pone busy de inmediato
  })

  it('idle sobre la sesión activa con la ventana enfocada no marca unread ni notifica', () => {
    open('s1')
    useCode.setState({ activeSessionID: 's1' })
    apply(statusBusy('s1', D))
    apply(statusIdle('s1', D))
    expect(st().unread['s1']).toBeUndefined()
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('idle sobre una sesión ya idle no dispara nada; con estado previo desconocido sí', () => {
    open('s1')
    apply(statusIdle('s1', D)) // prev undefined !== 'idle' => dispara (estado actual)
    expect(st().fsVersion).toBe(1)
    const fs = st().fsVersion
    apply(statusIdle('s1', D))
    apply(statusIdle('s1', D))
    expect(st().fsVersion).toBe(fs)
  })

  it('session.idle sube fsVersion siempre y notifica solo si venía ocupada', () => {
    open('s1')
    apply(statusBusy('s1', D))
    st().applyEvent({ id: 'i1', type: 'session.idle', properties: { sessionID: 's1' } } as never, D)
    expect(st().fsVersion).toBe(1)
    expect(sendNotification).toHaveBeenCalledTimes(1)
    st().applyEvent({ id: 'i2', type: 'session.idle', properties: { sessionID: 's1' } } as never, D)
    expect(st().fsVersion).toBe(2)
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })
})

describe('loadPending (vía loadSessions)', () => {
  it('F6-B5: una sesión ausente del mapa de estado pasa a idle (sin busy pegado)', async () => {
    installClient({ list: [makeSession('s1', D)], status: {} })
    open('s1')
    apply(statusBusy('s1', D))
    await st().loadSessions()
    expect(st().runState['s1']).toBe('idle')
  })

  it('F6-B5: las sesiones de otro proyecto no se tocan', async () => {
    installClient({ list: [makeSession('s1', D)], status: {} })
    open('s1')
    useCode.setState({ runState: { s1: 'busy', other: 'busy' }, sessionProject: { s1: D, other: '/otro' } })
    await st().loadSessions()
    expect(st().runState).toEqual({ s1: 'idle', other: 'busy' })
  })

  it('aplica el estado de las sesiones presentes en el mapa', async () => {
    installClient({ list: [makeSession('s1', D)], status: { s1: { type: 'busy' } } })
    await st().loadSessions()
    expect(st().runState['s1']).toBe('busy')
  })

  it('loadSessions elimina del proyecto las sesiones que no vienen en la lista', async () => {
    installClient({ list: [makeSession('root', D)] })
    open('root')
    open('gone')
    open('orphanKid', { parentID: 'gone' })
    await st().loadSessions()
    expect(Object.keys(st().sessions)).toEqual(['root'])
  })

  it('F6-B4: loadSessions conserva la hija (subagente) cuya raíz sigue; known(child) y sus mensajes siguen entrando', async () => {
    installClient({ list: [makeSession('root', D)] })
    open('root')
    open('child', { parentID: 'root' })
    await st().loadSessions()
    expect(Object.keys(st().sessions).sort()).toEqual(['child', 'root'])
    expect(st().sessionProject['child']).toBe(D)
    apply(msgUpdated(assistantMessage('msg_1', 'child'), D))
    apply(partUpdated(textPart('prt_1', 'msg_1', 'child', 'hola'), D))
    expect(st().messages['child'][0].parts).toHaveLength(1)
  })
})

describe('loadMessages (vía selectSession)', () => {
  it('F6-B6: fusiona el snapshot con un mensaje recibido por el stream durante la carga (msg_2 no se pierde)', async () => {
    let resolve!: (v: unknown) => void
    const pending = new Promise((r) => (resolve = r))
    installClient()
    const client = useServer.getState().client as unknown as { session: { messages: () => Promise<unknown> } }
    client.session.messages = () => pending
    open('s1')
    const load = st().selectSession('s1')
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D)) // llega por el stream, no está en el snapshot
    resolve({ data: [{ info: userMessage('msg_1', 's1'), parts: [textPart('prt_1', 'msg_1', 's1', 'snapshot')] }] })
    await load
    expect(st().messages['s1'].map((e) => e.info.id)).toEqual(['msg_1', 'msg_2'])
    expect(st().loadingMessages['s1']).toBe(false)
  })

  it('F6-B6: un delta en vuelo durante loadMessages no retrocede ni se duplica', async () => {
    let resolve!: (v: unknown) => void
    const pending = new Promise((r) => (resolve = r))
    installClient()
    const client = useServer.getState().client as unknown as { session: { messages: () => Promise<unknown> } }
    client.session.messages = () => pending
    open('s1')
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', ''), D))
    const load = st().selectSession('s1')
    apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'Hel' }, D))
    apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'prt_1', delta: 'lo' }, D))
    // el snapshot ya incluía el primer delta
    resolve({ data: [{ info: assistantMessage('msg_2', 's1'), parts: [textPart('prt_1', 'msg_2', 's1', 'Hel')] }] })
    await load
    expect((st().messages['s1'][0].parts[0] as { text: string }).text).toBe('Hello')
    expect(st().loadingMessages['s1']).toBe(false)
  })

  it('selectSession marca leída la sesión y guarda la última en localStorage', async () => {
    installClient()
    open('s1')
    useCode.setState({ unread: { s1: true } })
    await st().selectSession('s1')
    expect(st().unread['s1']).toBeUndefined()
    expect(localStorage.getItem(`code.session.${D}`)).toBe('s1')
  })
})

describe('eventos de archivos', () => {
  it('file.watcher.updated de otro directorio NO sube fsVersion (Pf1)', () => {
    vi.useFakeTimers()
    try {
      apply(fileWatcherUpdated('/otro/a.ts', '/otro'))
      vi.advanceTimersByTime(5000)
      expect(st().fsVersion).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('session.diff y file.edited suben fsVersion (agrupados por el debounce de Pf1)', () => {
    vi.useFakeTimers()
    try {
      st().applyEvent({ id: 'd1', type: 'session.diff', properties: { sessionID: 's', diff: [] } } as never, D)
      st().applyEvent({ id: 'd2', type: 'file.edited', properties: { file: 'a' } } as never, D)
      vi.advanceTimersByTime(400)
      expect(st().fsVersion).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('debounce y filtro de fsVersion (Pf1)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('100 file.watcher.updated en 300 ms dan 1 solo incremento', () => {
    for (let i = 0; i < 100; i++) {
      apply(fileWatcherUpdated(`${D}/f${i}.ts`, D))
      vi.advanceTimersByTime(3)
    }
    expect(st().fsVersion).toBe(0)
    vi.advanceTimersByTime(400)
    expect(st().fsVersion).toBe(1)
  })

  it('eventos de otro directorio: 0 incrementos', () => {
    for (let i = 0; i < 20; i++) apply(fileWatcherUpdated(`/otro/f${i}.ts`, '/otro'))
    vi.advanceTimersByTime(5000)
    expect(st().fsVersion).toBe(0)
  })

  it('el directorio del proyecto con barra final cuenta', () => {
    apply(fileWatcherUpdated(`${D}/a.ts`, `${D}/`))
    vi.advanceTimersByTime(400)
    expect(st().fsVersion).toBe(1)
  })

  it('un evento del worktree de una sesión del proyecto cuenta', () => {
    open('root')
    open('wt', { directory: '/work/code-wt', parentID: 'root' })
    expect(st().sessionProject['wt']).toBe(D)
    apply(fileWatcherUpdated('/work/code-wt/a.ts', '/work/code-wt'))
    vi.advanceTimersByTime(400)
    expect(st().fsVersion).toBe(1)
  })

  it('una ráfaga continua de 5 s da al menos 2 incrementos (maxWait)', () => {
    for (let t = 0; t < 5000; t += 50) {
      apply(fileWatcherUpdated(`${D}/f${t}.ts`, D))
      vi.advanceTimersByTime(50)
    }
    expect(st().fsVersion).toBeGreaterThanOrEqual(2)
  })

  it('touchFs es inmediato', () => {
    st().touchFs()
    expect(st().fsVersion).toBe(1)
  })

  it('revertTo y unrevert siguen inmediatos (sin debounce)', async () => {
    open('s1')
    useCode.setState({ activeSessionID: 's1' })
    const updated = makeSession('s1', D)
    const client = {
      session: {
        revert: () => Promise.resolve({ data: updated }),
        unrevert: () => Promise.resolve({ data: updated })
      }
    }
    useServer.setState({ client: client as never })
    await st().revertTo('m1')
    expect(st().fsVersion).toBe(1)
    await st().unrevert()
    expect(st().fsVersion).toBe(2)
  })

  it('soltar la suscripción cancela el bump pendiente', async () => {
    const { ensureCodeSubscription } = await import('./store')
    const off = ensureCodeSubscription()
    apply(fileWatcherUpdated(`${D}/a.ts`, D))
    off()
    vi.advanceTimersByTime(5000)
    expect(st().fsVersion).toBe(0)
  })
})

describe('sesiones y mensajes', () => {
  it('session.deleted borra la sesión y desactiva la activa', () => {
    open('s1')
    useCode.setState({ activeSessionID: 's1' })
    st().applyEvent({ id: 'x', type: 'session.deleted', properties: { sessionID: 's1', info: makeSession('s1', D) } } as never, D)
    expect(st().sessions['s1']).toBeUndefined()
    expect(st().activeSessionID).toBeNull()
  })

  it('una sesión hija hereda el proyecto del padre', () => {
    open('root')
    open('kid', { parentID: 'root' })
    expect(st().sessionProject['kid']).toBe(D)
  })

  it('partes huérfanas se adoptan al llegar message.updated', () => {
    open('s1')
    apply(partUpdated(textPart('prt_1', 'msg_2', 's1', 'hola'), D))
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    expect(st().messages['s1'][0].parts.map((p) => p.id)).toEqual(['prt_1'])
  })

  it('F6-B2: message.part.delta sobre parte inexistente se guarda y se aplica al llegar su part.updated', () => {
    open('s1')
    apply(msgUpdated(assistantMessage('msg_2', 's1'), D))
    apply(partDelta({ sessionID: 's1', messageID: 'msg_2', partID: 'nada', delta: 'x' }, D))
    expect(st().messages['s1'][0].parts).toEqual([])
    apply(partUpdated(textPart('nada', 'msg_2', 's1', ''), D))
    expect((st().messages['s1'][0].parts[0] as { text: string }).text).toBe('x')
  })
})
