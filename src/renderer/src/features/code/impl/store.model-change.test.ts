import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assistantMessage,
  makeSession,
  nextEventId,
  resetEventIds,
  statusIdle,
  textPart,
  userMessage
} from '../../../../../test/fixtures/events'
import type { TextPart, UserMessage } from '@opencode-ai/sdk/v2/client'
import type { OcEvent } from '../../../lib/opencode'
import type { CodeMessage } from './types'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
let useCode: (typeof import('./store'))['useCode']
let useExtrasPrefs: (typeof import('../../settings/impl/extras'))['useExtrasPrefs']
let useSettings: (typeof import('../../../stores/settings'))['useSettings']
const D = '/work/code'
const old = { providerID: 'p', modelID: 'old' }
const next = { providerID: 'p', modelID: 'new' }
const promptAsync = vi.fn(async (_args: unknown) => ({ data: {} }))
const messages = vi.fn(async (_args: unknown): Promise<{ data: CodeMessage[] }> => ({ data: [] }))
const payload = (sessionID = 's1') => ({ sessionID, anterior: old, nuevo: { ...next, variant: 'high' }, motivo: 'Lo pidió la persona' })
const event = (properties: unknown): OcEvent => ({ id: nextEventId(), type: 'session.modelo.cambiado', properties }) as unknown as OcEvent
const apply = (properties: unknown = payload(), dir = D) => useCode.getState().applyEvent(event(properties), dir)
const history = (synthetic = true): CodeMessage[] => [
  { info: userMessage('m1', 's1', { model: old }), parts: [textPart('p1', 'm1', 's1', 'hola')] },
  {
    info: { ...userMessage('m2', 's1', { model: next }), variant: 'high' } as UserMessage,
    parts: [{ ...(textPart('p2', 'm2', 's1', 'seguir') as TextPart), synthetic }]
  },
  { info: assistantMessage('m3', 's1'), parts: [textPart('p3', 'm3', 's1', 'listo')] }
]

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useExtrasPrefs } = await import('../../settings/impl/extras'))
  ;({ useSettings } = await import('../../../stores/settings'))
  const { useServer } = await import('../../../stores/server')
  const { useProviders } = await import('../../../stores/providers')
  messages.mockImplementation(async () => ({ data: [] }))
  useProviders.setState({
    loaded: true,
    providers: [
      { id: 'p', name: 'Proveedor', models: { old: { id: 'old', name: 'Anterior' }, new: { id: 'new', name: 'Nuevo visible' } } }
    ] as never
  })
  useServer.setState({
    client: {
      session: {
        messages,
        promptAsync,
        create: async () => ({ data: makeSession('new-session', D) }),
        update: async ({ sessionID }: { sessionID: string }) => ({ data: { id: sessionID } }),
        todo: async () => ({ data: [] })
      }
    } as never
  })
  ;(await import('./permission-rules')).setFolderMcp(D, { items: [], complete: true })
  useCode.setState({
    directory: D,
    sessions: { s1: makeSession('s1', D), s2: makeSession('s2', D) },
    sessionProject: { s1: D, s2: D },
    activeSessionID: 's1',
    model: old,
    variant: 'low'
  })
})

describe('cambio de modelo pedido con palabras en Código', () => {
  it('actualiza solo esa conversación sin tocar ajustes y sin requerir modo plan', async () => {
    const prefs = useExtrasPrefs.getState().prefs
    const settings = useSettings.getState().settings
    apply()
    expect(useCode.getState()).toMatchObject({ model: next, variant: 'high' })
    expect(useCode.getState().sessionModels.s2).toBeUndefined()
    expect(useExtrasPrefs.getState().prefs).toBe(prefs)
    expect(useSettings.getState().settings).toBe(settings)
    await useCode.getState().selectSession('s2')
    expect(useCode.getState().model).toBeNull()
    await useCode.getState().selectSession('s1')
    expect(useCode.getState().model).toEqual(next)
  })
  it('el siguiente envío usa el nuevo modelo/esfuerzo aunque haya modelo de ejecutar en ajustes', async () => {
    useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { exec: old } } })
    apply()
    expect(await useCode.getState().send('dale', [])).toBe(true)
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 's1', model: next, variant: 'high' }))
  })
  it('sin variante descarta el esfuerzo anterior', async () => {
    apply({ ...payload(), nuevo: next })
    await useCode.getState().send('dale', [])
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ model: next, variant: undefined }))
  })
  it('un evento de otra sesión conocida no mueve el selector activo; su cola usa el modelo propio', async () => {
    apply(payload('s2'))
    expect(useCode.getState()).toMatchObject({ model: old, variant: 'low' })
    expect(useCode.getState().modelChanges.s1).toBeUndefined()
    useCode.getState().enqueue('s2', 'dale', [])
    const idle = statusIdle('s2', D)
    useCode.getState().applyEvent(idle.event, D)
    await vi.waitFor(() =>
      expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 's2', model: next, variant: 'high' }))
    )
  })
  it('ignora sesiones desconocidas, directorios ajenos y payloads mal formados', () => {
    const state = useCode.getState()
    apply(payload('unknown'))
    apply(payload(), '/other')
    apply({ ...payload(), nuevo: { modelID: 'bad' } })
    expect(useCode.getState()).toBe(state)
  })
  it('un evento repetido no duplica el aviso', () => {
    const ev = event(payload())
    useCode.getState().applyEvent(ev, D)
    useCode.getState().applyEvent(ev, D)
    expect(useCode.getState().modelChanges.s1).toHaveLength(1)
  })
  it.each([true, false])('reabre con el último usuario del motor (sintético: %s), no con el asistente', async (synthetic) => {
    useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { exec: old } } })
    messages.mockResolvedValue({ data: history(synthetic) })
    useCode.setState({ activeSessionID: null, model: null })
    await useCode.getState().selectSession('s1')
    expect(useCode.getState()).toMatchObject({ model: next, variant: 'high' })
    await useCode.getState().send('continúa', [])
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ model: next, variant: 'high' }))
  })
  it('al reabrir sustituye una elección antigua en memoria por el último usuario del motor', async () => {
    useCode.getState().setModel(old, false)
    await useCode.getState().selectSession('s2')
    messages.mockResolvedValue({ data: history() })
    await useCode.getState().selectSession('s1')
    expect(useCode.getState()).toMatchObject({ model: next, variant: 'high' })
  })
  it('una elección manual posterior al evento sigue visible y se usa al enviar', async () => {
    useExtrasPrefs.setState({ prefs: { ...useExtrasPrefs.getState().prefs, planExecModels: { exec: next } } })
    apply()
    useCode.getState().setModel(old, false)
    await useCode.getState().send('dale', [])
    expect(useCode.getState().model).toEqual(old)
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ model: old }))
  })
  it('un snapshot antiguo en vuelo no pisa el evento y su resolución no cambia otra conversación', async () => {
    let resolve!: (v: { data: CodeMessage[] }) => void
    messages.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    useCode.setState({ activeSessionID: null, model: null })
    const loading = useCode.getState().selectSession('s1')
    apply()
    await useCode.getState().selectSession('s2')
    resolve({ data: history().slice(0, 1) })
    await loading
    expect(useCode.getState().model).toBeNull()
    expect(useCode.getState().sessionModels.s1.model).toEqual(next)
  })
  it('preserva la elección del borrador al crear la primera sesión', async () => {
    useCode.setState({ activeSessionID: null, model: next, variant: 'high' })
    await useCode.getState().send('hola', [])
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 'new-session', model: next, variant: 'high' }))
  })
  it('cerrar el proyecto purga modelos y avisos por sesión', () => {
    apply()
    useCode.getState().closeOneProject(D)
    expect(useCode.getState().sessionModels).toEqual({})
    expect(useCode.getState().modelChanges).toEqual({})
  })
})
