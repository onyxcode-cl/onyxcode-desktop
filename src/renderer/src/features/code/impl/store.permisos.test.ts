/**
 * El modo de permisos de la interfaz (Manual por defecto) tiene que llegar a la sesión del motor: al crearla y antes de cada envío.
 * Antes solo se aplicaba al CAMBIAR de modo con una sesión abierta: una sesión nueva corría con los permisos por defecto del motor
 * y «Manual» no preguntaba nada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, type TraceEvent } from '../../../../../test/fixtures/events'
import { rulesetFor } from './permission-rules'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
const D = '/work/code'

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  useCode.setState({ directory: D })
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const apply = (te: TraceEvent): void => st().applyEvent(te.event, te.directory)

function install(opts: { updateFails?: boolean } = {}) {
  const create = vi.fn((a: { directory: string; title?: string; permission?: unknown }) =>
    Promise.resolve({ data: makeSession('new', a.directory, { permission: a.permission as never }) })
  )
  const update = vi.fn((a: { sessionID: string; permission?: unknown }) =>
    opts.updateFails ? Promise.reject(new Error('no se pudo')) : Promise.resolve({ data: { id: a.sessionID, permission: a.permission } })
  )
  const promptAsync = vi.fn(() => Promise.resolve({ data: {} }))
  const client = {
    session: {
      create,
      update,
      promptAsync,
      list: () => Promise.resolve({ data: [] }),
      status: () => Promise.resolve({ data: {} }),
      messages: () => Promise.resolve({ data: [] }),
      todo: () => Promise.resolve({ data: [] })
    },
    permission: { list: () => Promise.resolve({ data: [] }) },
    question: { list: () => Promise.resolve({ data: [] }) }
  }
  useServer.setState({ client: client as never })
  return { create, update, promptAsync }
}

describe('modo de permisos → sesión del motor', () => {
  it('Manual es el modo por defecto y pregunta por edit, write, bash, webfetch, websearch, external_directory y task', () => {
    expect(st().permissionMode).toBe('manual')
    const rules = rulesetFor('manual') ?? []
    const asked = rules.filter((r) => r.action === 'ask' && r.pattern === '*').map((r) => r.permission)
    expect(asked).toEqual(['edit', 'write', 'bash', 'webfetch', 'websearch', 'external_directory', 'task'])
  })

  it('una sesión NUEVA nace con el ruleset del modo elegido', async () => {
    const { create } = install()
    await st().newSessionAt(D)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0].permission).toEqual(rulesetFor('manual'))
  })

  it('una sesión nueva en Bypass nace con permitir todo; en Plan nace con el bloque de plan (anula lo de antes)', async () => {
    const { create } = install()
    await st().setPermissionMode('bypass')
    await st().newSessionAt(D)
    expect(create.mock.calls[0]![0].permission).toEqual(rulesetFor('bypass'))
    await st().setPermissionMode('plan')
    await st().newSessionAt(D)
    expect(create.mock.calls[1]![0].permission).toEqual(rulesetFor('plan'))
  })

  it('una sesión antigua SIN ruleset recibe el del modo antes de enviar', async () => {
    const { update, promptAsync } = install()
    apply(sessionCreated(makeSession('s1', D))) // sin permission: como las creadas antes del arreglo
    useCode.setState({ activeSessionID: 's1' })
    const ok = await st().send('hola', [])
    expect(ok).toBe(true)
    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]![0].permission).toEqual(rulesetFor('manual'))
    expect(promptAsync).toHaveBeenCalledTimes(1)
    expect(update.mock.invocationCallOrder[0]).toBeLessThan(promptAsync.mock.invocationCallOrder[0]!)
  })

  it('si la sesión ya tiene el ruleset del modo, no se vuelve a pedir al motor', async () => {
    const { update, promptAsync } = install()
    apply(sessionCreated(makeSession('s1', D, { permission: rulesetFor('manual') })))
    useCode.setState({ activeSessionID: 's1' })
    await st().send('hola', [])
    expect(update).not.toHaveBeenCalled()
    expect(promptAsync).toHaveBeenCalledTimes(1)
  })

  it('en Manual, si no se puede fijar el ruleset, NO se envía (falla cerrado)', async () => {
    const { promptAsync } = install({ updateFails: true })
    apply(sessionCreated(makeSession('s1', D)))
    useCode.setState({ activeSessionID: 's1' })
    const ok = await st().send('hola', [])
    expect(ok).toBe(false)
    expect(promptAsync).not.toHaveBeenCalled()
    expect(st().errors['s1']).toBeTruthy()
  })

  it('cambiar de modo AÑADE el bloque nuevo, y reenviar el mismo modo no vuelve a pedirlo ni hace crecer la lista', async () => {
    // El motor acumula: simulamos `session.update` como lo hace (reglas viejas + nuevas).
    const sessions: Record<string, unknown[]> = {}
    const update = vi.fn((a: { sessionID: string; permission?: unknown[] }) => {
      sessions[a.sessionID] = [...(sessions[a.sessionID] ?? []), ...(a.permission ?? [])]
      return Promise.resolve({ data: { id: a.sessionID, permission: sessions[a.sessionID] } })
    })
    const promptAsync = vi.fn(() => Promise.resolve({ data: {} }))
    useServer.setState({
      client: {
        session: {
          update,
          promptAsync,
          list: () => Promise.resolve({ data: [] }),
          status: () => Promise.resolve({ data: {} }),
          messages: () => Promise.resolve({ data: [] }),
          todo: () => Promise.resolve({ data: [] })
        },
        permission: { list: () => Promise.resolve({ data: [] }) },
        question: { list: () => Promise.resolve({ data: [] }) }
      } as never
    })
    sessions['s1'] = [...rulesetFor('manual')]
    apply(sessionCreated(makeSession('s1', D, { permission: rulesetFor('manual') })))
    useCode.setState({ activeSessionID: 's1' })
    await st().setPermissionMode('auto')
    expect(update).toHaveBeenCalledTimes(1)
    const len = sessions['s1']!.length
    expect(len).toBe(rulesetFor('manual').length + rulesetFor('auto').length)
    // Enviar varios mensajes en el mismo modo no reenvía nada.
    await st().send('uno', [])
    await st().send('dos', [])
    await st().setPermissionMode('auto')
    expect(update).toHaveBeenCalledTimes(1)
    expect(sessions['s1']!.length).toBe(len)
    // Volver a Manual sí lo añade (una sola vez).
    await st().setPermissionMode('manual')
    await st().send('tres', [])
    expect(update).toHaveBeenCalledTimes(2)
  })

  it('el agente Plan manda sobre el modo: con Plan se envía el bloque de plan aunque el modo sea Editar sin preguntar', async () => {
    const { update } = install()
    await st().setPermissionMode('acceptEdits')
    apply(sessionCreated(makeSession('s1', D, { permission: rulesetFor('acceptEdits') })))
    useCode.setState({ activeSessionID: 's1', agent: 'plan' })
    await st().send('planea', [])
    expect(update.mock.calls[0]![0].permission).toEqual(rulesetFor('plan'))
  })

  describe('aprobación automática de comandos de lectura (Automático y Solo explorar)', () => {
    const asked = (id: string, command: string): void =>
      st().applyEvent(
        {
          type: 'permission.asked',
          properties: { id, sessionID: 's1', permission: 'bash', patterns: [command], metadata: { command }, always: [], tool: undefined }
        } as never,
        D
      )
    const setup = (rules: unknown): { reply: ReturnType<typeof vi.fn> } => {
      const reply = vi.fn(() => Promise.resolve({ data: true }))
      useServer.setState({ client: { permission: { reply, list: () => Promise.resolve({ data: [] }) } } as never })
      apply(sessionCreated(makeSession('s1', D, { permission: rules as never })))
      return { reply }
    }

    it('en Automático un comando simple de lectura se responde «una vez» sin tarjeta', () => {
      const { reply } = setup(rulesetFor('auto'))
      asked('p1', 'ls -la')
      expect(reply).toHaveBeenCalledWith({ requestID: 'p1', reply: 'once', directory: D })
      expect(st().permissions['p1']).toBeUndefined()
    })

    it('si el comando redirige, encadena o no está en la lista, sale la tarjeta y no se responde', () => {
      const { reply } = setup(rulesetFor('auto'))
      asked('p2', 'ls && ls > b.txt')
      asked('p3', 'echo hola > prueba.txt')
      asked('p4', 'npm install')
      expect(reply).not.toHaveBeenCalled()
      expect(Object.keys(st().permissions).sort()).toEqual(['p2', 'p3', 'p4'])
    })

    it('en «Editar sin preguntar» y «Preguntar siempre» nunca se aprueba solo', () => {
      for (const mode of ['acceptEdits', 'manual'] as const) {
        useCode.setState({ permissions: {} })
        const { reply } = setup(rulesetFor(mode))
        asked('p5', 'ls')
        expect(reply).not.toHaveBeenCalled()
        expect(st().permissions['p5']).toBeDefined()
      }
    })

    it('una sesión que venía de Preguntar siempre y pasó a Automático se aprueba igual que una nueva', () => {
      const { reply } = setup([...rulesetFor('manual'), ...rulesetFor('auto')])
      asked('p6', 'pwd')
      expect(reply).toHaveBeenCalledTimes(1)
    })
  })
})
