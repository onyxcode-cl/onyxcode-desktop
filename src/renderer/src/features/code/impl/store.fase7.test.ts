/**
 * Fase 7 · G3: correcciones de `features/code/impl/store.ts` (F7-B10, B11, B16, B17, B18).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@opencode-ai/sdk/v2/client'
import {
  makeSession,
  msgUpdated,
  permAsked,
  resetEventIds,
  sessionCreated,
  statusBusy,
  statusIdle,
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
  localStorage.clear()
  sendNotification.mockClear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const apply = (te: TraceEvent): void => st().applyEvent(te.event, te.directory)
const open = (id: string, extra: Partial<Session> = {}): void => apply(sessionCreated(makeSession(id, D, extra)))
const idleEvt = (sessionID: string, id: string): void =>
  st().applyEvent({ id, type: 'session.idle', properties: { sessionID } } as never, D)
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

interface FakeOpts {
  list?: Session[]
  status?: Record<string, { type: string }>
  messages?: () => Promise<unknown>
  perms?: unknown[]
  questions?: unknown[]
  promptAsync?: () => Promise<unknown>
}
function installClient(o: FakeOpts = {}): { promptAsync: ReturnType<typeof vi.fn>; messages: ReturnType<typeof vi.fn> } {
  const promptAsync = vi.fn(o.promptAsync ?? (() => Promise.resolve({ data: {} })))
  const messages = vi.fn(o.messages ?? (() => Promise.resolve({ data: [] })))
  const client = {
    session: {
      list: () => Promise.resolve({ data: o.list ?? [] }),
      status: () => Promise.resolve({ data: o.status ?? {} }),
      messages,
      todo: () => Promise.resolve({ data: [] }),
      delete: () => Promise.resolve({ data: true }),
      promptAsync
    },
    permission: { list: () => Promise.resolve({ data: o.perms ?? [] }) },
    question: { list: () => Promise.resolve({ data: o.questions ?? [] }) }
  }
  useServer.setState({ client: client as never })
  return { promptAsync, messages }
}

describe('F7-B10: loadPending y runState huérfano', () => {
  it('una sesión que el servidor ya no lista no deja runState busy', async () => {
    installClient({ list: [], status: {} })
    open('s1')
    apply(statusBusy('s1', D))
    await st().loadSessions() // `s1` desaparece de sessions/sessionProject
    expect(st().sessions['s1']).toBeUndefined()
    expect(st().runState['s1']).toBe('idle')
  })

  it('no degrada una sesión que pasó a busy mientras se pedía el estado', async () => {
    installClient({ list: [makeSession('s1', D)], status: {} })
    open('s1')
    // El evento busy llega mientras `session.status` está en vuelo; la respuesta (foto anterior) no lo lista.
    const client = useServer.getState().client as unknown as { session: { status: () => Promise<unknown> } }
    const status = client.session.status
    client.session.status = () => {
      apply(statusBusy('s1', D))
      return status()
    }
    await st().loadSessions()
    expect(st().runState['s1']).toBe('busy')
  })
})

describe('F7-B11: cargas concurrentes de mensajes', () => {
  it('selectSession dos veces seguidas reutiliza la carga y deja loadingMessages en false', async () => {
    const d = deferred<unknown>()
    const { messages } = installClient({ messages: () => d.promise })
    open('s1')
    const a = st().selectSession('s1')
    const b = st().selectSession('s1')
    expect(st().loadingMessages['s1']).toBe(true)
    d.resolve({ data: [{ info: userMessage('m1', 's1'), parts: [] }] })
    await Promise.all([a, b])
    expect(messages).toHaveBeenCalledTimes(1)
    expect(st().loadingMessages['s1']).toBe(false)
    expect(st().messages['s1'].map((e) => e.info.id)).toEqual(['m1'])
  })

  it('un mensaje del stream durante la carga se conserva aunque haya dos llamadas', async () => {
    const d = deferred<unknown>()
    installClient({ messages: () => d.promise })
    open('s1')
    const a = st().selectSession('s1')
    const b = st().selectSession('s1')
    apply(msgUpdated(userMessage('m9', 's1'), D))
    d.resolve({ data: [] })
    await Promise.all([a, b])
    expect(st().messages['s1'].map((e) => e.info.id)).toEqual(['m9'])
  })

  it('borrar la sesión durante la carga no la resucita', async () => {
    const d = deferred<unknown>()
    installClient({ messages: () => d.promise })
    open('s1')
    const load = st().selectSession('s1')
    await st().deleteSession('s1')
    d.resolve({ data: [{ info: userMessage('m1', 's1'), parts: [] }] })
    await load
    expect(st().messages['s1']).toBeUndefined()
    expect(st().loadingMessages['s1']).toBeUndefined()
  })
})

describe('F7-B16: loadPending reconstruye permisos y preguntas desde el servidor', () => {
  const perm = (id: string, sessionID: string): unknown => ({ id, sessionID, permission: 'bash', patterns: [], always: [], metadata: {} })

  it('descarta el permiso que el servidor ya no lista (respondido desde otro cliente)', async () => {
    installClient({ list: [makeSession('s1', D)], perms: [] })
    open('s1')
    apply(permAsked({ id: 'per_old', sessionID: 's1' }, D))
    expect(st().permissions['per_old']).toBeDefined()
    await st().loadSessions()
    expect(st().permissions['per_old']).toBeUndefined()
  })

  it('añade los que el servidor lista y conserva los de otros proyectos', async () => {
    installClient({ list: [makeSession('s1', D)], perms: [perm('per_new', 's1')] })
    open('s1')
    useCode.setState({
      sessionProject: { ...st().sessionProject, other: '/otro' },
      permissions: {
        per_other: { id: 'per_other', sessionID: 'other', permission: 'bash', patterns: [], metadata: {}, always: [], api: 'v1' }
      }
    })
    await st().loadSessions()
    expect(Object.keys(st().permissions).sort()).toEqual(['per_new', 'per_other'])
  })

  it('conserva el permiso que llegó por evento mientras se pedía la lista', async () => {
    installClient({ list: [makeSession('s1', D)], perms: [] })
    open('s1')
    const client = useServer.getState().client as unknown as { permission: { list: () => Promise<unknown> } }
    const list = client.permission.list
    client.permission.list = () => {
      apply(permAsked({ id: 'per_live', sessionID: 's1' }, D))
      return list() // la foto del servidor es anterior al evento
    }
    await st().loadSessions()
    expect(st().permissions['per_live']).toBeDefined()
  })

  it('si la petición falla no borra los pendientes', async () => {
    installClient({ list: [makeSession('s1', D)] })
    open('s1')
    apply(permAsked({ id: 'per_1', sessionID: 's1' }, D))
    const client = useServer.getState().client as unknown as { permission: { list: () => Promise<unknown> } }
    client.permission.list = () => Promise.reject(new Error('red'))
    await st().loadSessions()
    expect(st().permissions['per_1']).toBeDefined()
  })

  it('las preguntas también se reconstruyen', async () => {
    installClient({ list: [makeSession('s1', D)], questions: [{ id: 'q_new', sessionID: 's1', questions: [] }] })
    open('s1')
    useCode.setState({ questions: { q_old: { id: 'q_old', sessionID: 's1', questions: [] } } })
    await st().loadSessions()
    expect(Object.keys(st().questions)).toEqual(['q_new'])
  })
})

describe('F7-B17: borrar una sesión de Code limpia todo su estado', () => {
  function fill(id: string): void {
    open(id)
    apply(msgUpdated(userMessage(`m_${id}`, id), D))
    apply(statusBusy(id, D))
    apply(permAsked({ id: `per_${id}`, sessionID: id }, D))
    st().enqueue(id, 'pendiente')
    useCode.setState((s) => ({
      todos: { ...s.todos, [id]: [] },
      errors: { ...s.errors, [id]: 'x' },
      unread: { ...s.unread, [id]: true },
      questions: { ...s.questions, [`q_${id}`]: { id: `q_${id}`, sessionID: id, questions: [] } }
    }))
  }
  const slices = ['sessions', 'sessionProject', 'messages', 'queue', 'todos', 'runState', 'errors', 'unread'] as const

  it('deleteSession', async () => {
    installClient()
    fill('s1')
    fill('s2')
    await st().deleteSession('s1')
    for (const k of slices) expect(Object.keys(st()[k]), k).toEqual(['s2'])
    expect(Object.keys(st().permissions)).toEqual(['per_s2'])
    expect(Object.keys(st().questions)).toEqual(['q_s2'])
  })

  it('session.deleted (evento)', () => {
    fill('s1')
    fill('s2')
    st().applyEvent({ id: 'del1', type: 'session.deleted', properties: { sessionID: 's1', info: makeSession('s1', D) } } as never, D)
    for (const k of slices) expect(Object.keys(st()[k]), k).toEqual(['s2'])
    expect(Object.keys(st().permissions)).toEqual(['per_s2'])
    expect(Object.keys(st().questions)).toEqual(['q_s2'])
  })
})

describe('F7-B18: session.status→idle + session.idle de una misma terminación', () => {
  const queue3 = (id: string): void => {
    for (const t of ['uno', 'dos', 'tres']) st().enqueue(id, t)
  }
  const sent = (p: ReturnType<typeof vi.fn>): string[] =>
    p.mock.calls.map((c) => ((c as unknown[])[0] as { parts: { text: string }[] }).parts[0].text)

  it('status idle seguido de session.idle: notifica una vez y envía UN solo ítem de la cola (sin pisar el busy)', () => {
    const { promptAsync } = installClient()
    open('s1')
    apply(statusBusy('s1', D))
    queue3('s1')
    apply(statusIdle('s1', D))
    expect(sent(promptAsync)).toEqual(['uno'])
    expect(st().runState['s1']).toBe('busy') // doSend
    idleEvt('s1', 'i1') // duplicado
    expect(sent(promptAsync)).toEqual(['uno'])
    expect(st().runState['s1']).toBe('busy')
    expect(st().queue['s1'].map((q) => q.text)).toEqual(['dos', 'tres'])
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('orden inverso (session.idle y luego status idle) tampoco duplica', () => {
    const { promptAsync } = installClient()
    open('s1')
    apply(statusBusy('s1', D))
    queue3('s1')
    idleEvt('s1', 'i1')
    apply(statusIdle('s1', D))
    expect(sent(promptAsync)).toEqual(['uno'])
    expect(st().runState['s1']).toBe('busy')
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('cola de 3 con ambos eventos por ejecución: se envían en orden, uno por terminación', () => {
    const { promptAsync } = installClient()
    open('s1')
    apply(statusBusy('s1', D))
    queue3('s1')
    for (let i = 0; i < 3; i++) {
      apply(statusIdle('s1', D))
      idleEvt('s1', `dup${i}`)
      apply(statusBusy('s1', D)) // el servidor confirma la nueva ejecución
    }
    expect(sent(promptAsync)).toEqual(['uno', 'dos', 'tres'])
    expect(st().queue['s1']).toEqual([])
  })

  it('session.idle con la sesión ya idle no lanza el siguiente ni notifica', () => {
    const { promptAsync } = installClient()
    open('s1')
    apply(statusBusy('s1', D))
    apply(statusIdle('s1', D))
    st().enqueue('s1', 'tarde')
    idleEvt('s1', 'i1')
    expect(promptAsync).not.toHaveBeenCalled()
    expect(sendNotification).toHaveBeenCalledTimes(1)
  })

  it('un session.idle solo (sin status) sigue funcionando en ejecuciones sucesivas', () => {
    const { promptAsync } = installClient()
    open('s1')
    apply(statusBusy('s1', D))
    queue3('s1')
    idleEvt('s1', 'i1')
    expect(sent(promptAsync)).toEqual(['uno'])
    idleEvt('s1', 'i2') // misma clase de evento, sesión busy por doSend: terminación real
    expect(sent(promptAsync)).toEqual(['uno', 'dos'])
  })

  it('si doSend falla el ítem vuelve al frente de la cola', async () => {
    installClient({ promptAsync: () => Promise.reject(new Error('sin red')) })
    open('s1')
    apply(statusBusy('s1', D))
    st().enqueue('s1', 'uno')
    st().enqueue('s1', 'dos')
    apply(statusIdle('s1', D))
    await vi.waitFor(() => expect(st().queue['s1'].map((q) => q.text)).toEqual(['uno', 'dos']))
    expect(st().runState['s1']).toBe('idle')
    expect(st().errors['s1']).toBeTruthy()
  })
})
