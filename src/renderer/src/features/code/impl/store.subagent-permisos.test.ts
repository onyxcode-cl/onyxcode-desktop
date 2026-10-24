/**
 * Permisos y preguntas de sesiones HIJAS (subagentes): llegan con el `sessionID` de la hija mientras la raíz figura `idle`.
 * La conversación raíz los muestra, responde contra la hija correcta, «siempre» no amplía nada y cuenta como «ocupada».
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeSession,
  msgUpdated,
  partUpdated,
  resetEventIds,
  sessionCreated,
  statusBusy,
  statusIdle,
  type TraceEvent,
  userMessage,
  toolPart
} from '../../../../../test/fixtures/events'
import { rulesetFor } from './permission-rules'

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

function install(): {
  reply: ReturnType<typeof vi.fn>
  v2reply: ReturnType<typeof vi.fn>
  abort: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
} {
  const reply = vi.fn(() => Promise.resolve({ data: true }))
  const v2reply = vi.fn(() => Promise.resolve({ data: true }))
  const abort = vi.fn(() => Promise.resolve({ data: true }))
  const update = vi.fn(() => Promise.resolve({ data: {} }))
  useServer.setState({
    client: {
      permission: { reply, list: () => Promise.resolve({ data: [] }) },
      v2: { session: { permission: { reply: v2reply } } },
      session: { abort, update, status: () => Promise.resolve({ data: {} }) },
      question: { list: () => Promise.resolve({ data: [] }) }
    } as never
  })
  return { reply, v2reply, abort, update }
}

/** Raíz abierta con un subagente de fondo («Revisar logs») como sesión hija. */
function openWithHelper(): void {
  apply(sessionCreated(makeSession('root', D, { title: 'Mi proyecto', permission: rulesetFor('manual') })))
  apply(sessionCreated(makeSession('kid', D, { parentID: 'root', title: 'Revisar logs (@explore subagent)' })))
  apply(msgUpdated(userMessage('m1', 'root'), D))
  apply(
    partUpdated(
      toolPart('p1', 'm1', 'root', 'task', {
        status: 'completed',
        input: { description: 'Revisar logs', subagent_type: 'explore', background: true },
        metadata: { sessionId: 'kid', background: true }
      }),
      D
    )
  )
  useCode.setState({ activeSessionID: 'root' })
}

const ask = (id: string, sessionID: string, permission = 'bash', command = 'npm run build'): void =>
  st().applyEvent(
    {
      type: 'permission.asked',
      properties: { id, sessionID, permission, patterns: [command], metadata: { command }, always: [command] }
    } as never,
    D
  )

describe('permisos de un subagente (sesión hija)', () => {
  it('el permiso de la hija queda guardado con el sessionID de la hija y se atribuye a la conversación raíz', async () => {
    install()
    openWithHelper()
    useCode.setState({ activeSessionID: null })
    ask('perm_kid', 'kid')
    expect(st().permissions['perm_kid']?.sessionID).toBe('kid')
    // El Dock y la lista cuentan la raíz, no la hija.
    expect(st().unread['root']).toBe(true)
    expect(st().unread['kid']).toBeUndefined()
    const { selectCodeAttentionCount } = await import('./store')
    expect(selectCodeAttentionCount(st())).toBe(1)
  })

  it('«una vez» responde contra el permiso de la hija, en el directorio de la hija', async () => {
    const { reply } = install()
    openWithHelper()
    ask('perm_kid', 'kid')
    await st().replyPermission(st().permissions['perm_kid']!, 'once')
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm_kid', reply: 'once', directory: D })
    expect(st().permissions['perm_kid']).toBeUndefined()
  })

  it('detener la conversación rechaza los permisos pendientes de ella y de sus ayudantes (no se pueden aprobar después)', async () => {
    const { reply, abort } = install()
    openWithHelper()
    ask('perm_root', 'root')
    ask('perm_kid', 'kid')
    await st().abort()
    expect(abort).toHaveBeenCalled()
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm_root', reply: 'reject', directory: D })
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm_kid', reply: 'reject', directory: D })
    expect(st().permissions['perm_root']).toBeUndefined()
    expect(st().permissions['perm_kid']).toBeUndefined()
  })

  it('«rechazar» llega tal cual', async () => {
    const { reply } = install()
    openWithHelper()
    ask('perm_kid', 'kid')
    await st().replyPermission(st().permissions['perm_kid']!, 'reject')
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm_kid', reply: 'reject', directory: D })
  })

  it('«siempre» desde una hija se envía como «una vez» y no toca las reglas de la raíz ni de la hija', async () => {
    const { reply, update } = install()
    openWithHelper()
    const before = JSON.stringify(st().sessions['root']?.permission)
    ask('perm_kid', 'kid')
    await st().replyPermission(st().permissions['perm_kid']!, 'always')
    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm_kid', reply: 'once', directory: D })
    expect(update).not.toHaveBeenCalled()
    expect(JSON.stringify(st().sessions['root']?.permission)).toBe(before)
  })

  it('«siempre» desde la propia raíz sigue siendo «siempre» (comportamiento de siempre)', async () => {
    const { reply } = install()
    openWithHelper()
    ask('perm_root', 'root')
    await st().replyPermission(st().permissions['perm_root']!, 'always')
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm_root', reply: 'always', directory: D })
  })

  it('el protocolo v2 también degrada «siempre» a «una vez» en una hija', async () => {
    const { v2reply } = install()
    openWithHelper()
    st().applyEvent(
      {
        type: 'permission.v2.asked',
        properties: { id: 'perm_v2', sessionID: 'kid', action: 'bash', resources: ['ls'], metadata: {}, save: ['ls'] }
      } as never,
      D
    )
    await st().replyPermission(st().permissions['perm_v2']!, 'always')
    expect(v2reply).toHaveBeenCalledWith({ sessionID: 'kid', requestID: 'perm_v2', reply: 'once' })
  })

  it('el modo Automático no aprueba solo el comando de una hija (su sesión no lleva el bloque del modo)', () => {
    const { reply } = install()
    apply(sessionCreated(makeSession('root', D, { permission: rulesetFor('auto') })))
    apply(sessionCreated(makeSession('kid', D, { parentID: 'root' })))
    useCode.setState({ activeSessionID: 'root' })
    ask('perm_kid', 'kid', 'bash', 'ls -la')
    expect(reply).not.toHaveBeenCalled()
    expect(st().permissions['perm_kid']).toBeDefined()
    // La misma orden en la raíz sí se aprueba (comportamiento previo, sin cambios).
    ask('perm_root', 'root', 'bash', 'ls -la')
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm_root', reply: 'once', directory: D })
  })

  it('aviso nativo: de una hija dice «ayudante», abre la raíz y no se manda con la raíz abierta y enfocada', () => {
    install()
    openWithHelper()
    useCode.setState({ activeSessionID: null })
    ask('perm_kid', 'kid')
    expect(sendNotification).toHaveBeenCalledWith('Un ayudante de Code necesita tu aprobación', 'Mi proyecto', {
      mode: 'code',
      id: 'root',
      directory: D
    })
    sendNotification.mockClear()
    useCode.setState({ activeSessionID: 'root', unread: {} })
    ask('perm_kid2', 'kid')
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('la pregunta de una hija se guarda con su sessionID y se atribuye a la raíz', () => {
    install()
    openWithHelper()
    useCode.setState({ activeSessionID: null })
    st().applyEvent({ type: 'question.asked', properties: { id: 'q1', sessionID: 'kid', questions: [] } } as never, D)
    expect(st().questions['q1']?.sessionID).toBe('kid')
    expect(sendNotification).toHaveBeenCalledWith('Un ayudante de Code tiene una pregunta para ti', 'Mi proyecto', {
      mode: 'code',
      id: 'root',
      directory: D
    })
  })
})

describe('«ocupado» de la raíz con ayudantes en segundo plano', () => {
  it('la raíz idle con una hija de fondo trabajando figura ocupada', async () => {
    install()
    openWithHelper()
    apply(statusIdle('root', D))
    apply(statusBusy('kid', D))
    const { selectCodeRunOf, selectCodeBackgroundBusyRoots, liveHelperCount } = await import('./store')
    expect(st().runState['root']).toBe('idle')
    expect(selectCodeRunOf(st(), 'root')).toBe('busy')
    expect(selectCodeBackgroundBusyRoots(st())).toEqual(['root'])
    expect(liveHelperCount(st(), 'root')).toBe(1)
    apply(statusIdle('kid', D))
    expect(selectCodeRunOf(st(), 'root')).toBe('idle')
    expect(liveHelperCount(st(), 'root')).toBe(0)
  })

  it('una sesión sin hijas se comporta exactamente igual que antes', async () => {
    install()
    apply(sessionCreated(makeSession('solo', D)))
    const { selectCodeRunOf, liveHelperCount } = await import('./store')
    expect(selectCodeRunOf(st(), 'solo')).toBeUndefined()
    apply(statusBusy('solo', D))
    expect(selectCodeRunOf(st(), 'solo')).toBe('busy')
    apply(statusIdle('solo', D))
    expect(selectCodeRunOf(st(), 'solo')).toBe('idle')
    expect(liveHelperCount(st(), 'solo')).toBe(0)
    expect(selectCodeRunOf(st(), null)).toBeUndefined()
  })

  it('Detener la raíz detiene también a los ayudantes vivos (cada uno contra su propia sesión)', async () => {
    const { abort } = install()
    openWithHelper()
    apply(statusIdle('root', D))
    apply(statusBusy('kid', D))
    await st().abort()
    const ids = abort.mock.calls.map((c) => (c[0] as { sessionID: string }).sessionID)
    expect(ids).toEqual(['root', 'kid'])
  })

  it('Detener una conversación sin ayudantes aborta solo esa sesión', async () => {
    const { abort } = install()
    apply(sessionCreated(makeSession('solo', D)))
    useCode.setState({ activeSessionID: 'solo' })
    apply(statusBusy('solo', D))
    await st().abort()
    expect(abort).toHaveBeenCalledTimes(1)
    expect((abort.mock.calls[0]![0] as { sessionID: string }).sessionID).toBe('solo')
  })
})
