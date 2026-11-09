/** D2: el modelo de cada mensaje sale según el agente (planear / ejecutar), con aviso si el elegido ya no está. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
let useProviders: (typeof import('../../../stores/providers'))['useProviders']
let useExtrasPrefs: (typeof import('../../settings/impl/extras'))['useExtrasPrefs']
const D = '/work/code'
const conv = { providerID: 'openai', modelID: 'gpt-5-mini' }
const strong = { providerID: 'anthropic', modelID: 'big' }
const cheap = { providerID: 'deepseek', modelID: 'cheap' }
const prov = (id: string, models: string[]): never =>
  ({ id, name: id, models: Object.fromEntries(models.map((m) => [m, { id: m, name: m }])) }) as never

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  ;({ useProviders } = await import('../../../stores/providers'))
  ;({ useExtrasPrefs } = await import('../../settings/impl/extras'))
  useCode.setState({ directory: D })
  ;(await import('./permission-rules')).setFolderMcp(D, { items: [], complete: true })
  useProviders.setState({
    loaded: true,
    providers: [prov('openai', ['gpt-5-mini']), prov('anthropic', ['big']), prov('deepseek', ['cheap'])]
  })
  const promptAsync = vi.fn(() => Promise.resolve({ data: {} }))
  const client = {
    session: {
      create: (a: { directory: string }) => Promise.resolve({ data: makeSession('new', a.directory) }),
      update: (a: { sessionID: string; permission?: unknown }) => Promise.resolve({ data: { id: a.sessionID, permission: a.permission } }),
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
  ;(globalThis as { __pa?: unknown }).__pa = promptAsync
  useCode.getState().applyEvent(sessionCreated(makeSession('s1', D)).event, D)
  useCode.setState({ activeSessionID: 's1', model: conv })
})

const sent = (): { agent: string; model?: { providerID: string; modelID: string }; variant?: string }[] =>
  ((globalThis as { __pa?: { mock: { calls: unknown[][] } } }).__pa?.mock.calls ?? []).map((c) => c[0] as never)

describe('modelo para planear y para ejecutar en Code', () => {
  it('sin ajustes: siempre el modelo de la conversación', async () => {
    await useCode.getState().send('hola', [])
    useCode.getState().setAgent('plan')
    await useCode.getState().send('plan', [])
    expect(sent().map((c) => c.model)).toEqual([conv, conv])
  })

  it('Planear sale con el de planear y al pasar a Hacer con el de ejecutar (proveedores distintos)', async () => {
    useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { plan: strong, exec: cheap } } })
    useCode.getState().setAgent('plan')
    await useCode.getState().send('planifica', [])
    useCode.getState().setAgent('build')
    await useCode.getState().send('hazlo', [])
    expect(sent().map((c) => [c.agent, c.model])).toEqual([
      ['plan', strong],
      ['build', cheap]
    ])
  })

  it('el esfuerzo (variant) de la conversación no se manda con otro modelo', async () => {
    useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { exec: cheap } } })
    useCode.setState({ variant: 'high' })
    await useCode.getState().send('hazlo', [])
    expect(sent()[0]!.variant).toBeUndefined()
  })

  it('cambiarlo en la conversación gana a los ajustes y no los toca', async () => {
    useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { exec: cheap } } })
    useCode.getState().setRoleModel('exec', strong)
    await useCode.getState().send('hazlo', [])
    expect(sent()[0]!.model).toEqual(strong)
    expect(useExtrasPrefs.getState().prefs.planExecModels).toEqual({ exec: cheap })
  })

  it('si el elegido ya no existe: se envía con el de la conversación y queda un aviso', async () => {
    useExtrasPrefs.setState({
      prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { exec: { providerID: 'gone', modelID: 'x' } } }
    })
    const ok = await useCode.getState().send('hazlo', [])
    expect(ok).toBe(true)
    expect(sent()[0]!.model).toEqual(conv)
    expect(useCode.getState().roleNotices['s1']).toMatchObject({ role: 'exec', wanted: { providerID: 'gone' }, used: conv })
    // Al volver a estar disponible, el aviso se va.
    useProviders.setState({ providers: [prov('openai', ['gpt-5-mini']), prov('gone', ['x'])] })
    await useCode.getState().send('otra', [])
    expect(sent()[1]!.model).toEqual({ providerID: 'gone', modelID: 'x' })
    expect(useCode.getState().roleNotices['s1']).toBeUndefined()
  })
})
