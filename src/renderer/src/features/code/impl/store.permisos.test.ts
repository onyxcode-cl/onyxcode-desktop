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
  it('Manual es el modo por defecto y pregunta por edit, write, bash, webfetch, websearch y external_directory', () => {
    expect(st().permissionMode).toBe('manual')
    const rules = rulesetFor('manual') ?? []
    expect(rules.map((r) => r.permission)).toEqual(['edit', 'write', 'bash', 'webfetch', 'websearch', 'external_directory'])
    expect(rules.every((r) => r.action === 'ask')).toBe(true)
  })

  it('una sesión NUEVA nace con el ruleset del modo elegido', async () => {
    const { create } = install()
    await st().newSessionAt(D)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]![0].permission).toEqual(rulesetFor('manual'))
  })

  it('una sesión nueva en Bypass nace con permitir todo; en Plan no manda ruleset (lo decide el agente)', async () => {
    const { create } = install()
    await st().setPermissionMode('bypass')
    await st().newSessionAt(D)
    expect(create.mock.calls[0]![0].permission).toEqual(rulesetFor('bypass'))
    await st().setPermissionMode('plan')
    await st().newSessionAt(D)
    expect(create.mock.calls[1]![0].permission).toBeUndefined()
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
})
