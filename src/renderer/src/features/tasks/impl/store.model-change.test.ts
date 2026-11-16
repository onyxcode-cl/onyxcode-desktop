import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserMessage } from '@opencode-ai/sdk/v2/client'
import type { OcEvent } from '../../../lib/opencode'
import type { MessageEntry } from '../../../stores/sessions'
import { assistantMessage, makeSession, nextEventId, textPart, userMessage } from '../../../../../test/fixtures/events'
import { parseModelChanged } from '@shared/model-change'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
let C: typeof import('./store')
let A: typeof import('./actions')
let S: (typeof import('../../../stores/sessions'))['useSessions']
let prefs: (typeof import('../../settings/impl/extras'))['useExtrasPrefs']
let settings: (typeof import('../../../stores/settings'))['useSettings']
const D = '/work/tasks'
const engine = 'http://tasks.test'
const old = { providerID: 'p', modelID: 'old' }
const next = { providerID: 'p', modelID: 'new' }
const payload = (sessionID = 's1') => ({ sessionID, anterior: old, nuevo: next, motivo: 'La persona pidió seguir con Nuevo visible' })
const event = (properties: unknown): OcEvent => ({ id: nextEventId(), type: 'session.modelo.cambiado', properties }) as unknown as OcEvent
const apply = (properties: unknown = payload(), directory = D) => C.handleEvent(event(properties), directory)
const messages = vi.fn(async (_args: unknown): Promise<{ data: MessageEntry[] }> => ({ data: [] }))
const promptAsync = vi.fn(async (_args: unknown) => ({ data: {} }))
const history = (synthetic: boolean, variant?: string): MessageEntry[] => [
  { info: userMessage('m1', 's1', { model: old }), parts: [] },
  {
    info: { ...userMessage('m2', 's1', { model: next }), ...(variant ? { variant } : {}) } as UserMessage,
    parts: [{ ...textPart('p2', 'm2', 's1', 'La persona pidió seguir con Nuevo visible'), synthetic } as never]
  },
  { info: assistantMessage('m3', 's1', { providerID: 'p', modelID: 'old' }), parts: [] }
]

beforeEach(async () => {
  vi.resetModules()
  vi.clearAllMocks()
  localStorage.clear()
  C = await import('./store')
  A = await import('./actions')
  ;({ useSessions: S } = await import('../../../stores/sessions'))
  ;({ useExtrasPrefs: prefs } = await import('../../settings/impl/extras'))
  ;({ useSettings: settings } = await import('../../../stores/settings'))
  const { useProviders } = await import('../../../stores/providers')
  useProviders.setState({
    loaded: true,
    providers: [
      {
        id: 'p',
        name: 'Proveedor',
        models: {
          old: { id: 'old', name: 'Anterior' },
          new: { id: 'new', name: 'Nuevo visible' }
        }
      }
    ] as never
  })
  messages.mockResolvedValue({ data: [] })
  C.useTasks.setState({
    folder: D,
    activeTaskId: 's1',
    taskModel: old,
    taskVariant: 'low',
    phase: 'ready',
    conn: { folder: D, directory: D, pathMap: { kind: 'identity' }, baseUrl: engine, fullAccess: false, sandboxed: false } as never,
    client: { session: { messages, promptAsync, todo: async () => ({ data: [] }), status: async () => ({ data: {} }) } } as never
  })
  S.setState({
    sessions: { s1: makeSession('s1', D), s2: makeSession('s2', D), child: { ...makeSession('child', D), parentID: 's1' } },
    sessionSource: { s1: engine, s2: engine, child: engine }
  })
})

describe('cambio de modelo pedido con palabras en Overdrive', () => {
  it('valida el contrato confirmado sin variante y actualiza solo esa tarea sin cambiar preferencias', async () => {
    expect(parseModelChanged(payload())).toEqual(payload())
    const beforePrefs = prefs.getState().prefs
    const beforeSettings = settings.getState().settings
    apply()
    expect(C.currentTasksModel()).toEqual(next)
    expect(C.currentTasksVariant()).toBeUndefined()
    expect(C.useTasks.getState().taskModels.s2).toBeUndefined()
    expect(prefs.getState().prefs).toBe(beforePrefs)
    expect(settings.getState().settings).toBe(beforeSettings)
    await A.sendToTask('dale', C.currentTasksModel())
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 's1', model: next }))
    expect(promptAsync.mock.calls[0][0]).not.toHaveProperty('variant')
  })
  it('otra tarea y un ayudante no mueven el selector ni el aviso de la activa', async () => {
    apply(payload('s2'))
    apply(payload('child'))
    expect(C.currentTasksModel()).toEqual(old)
    expect(C.currentTasksVariant()).toBe('low')
    expect(C.useTasks.getState().modelChanges.s1).toBeUndefined()
    await A.openTask('s2')
    expect(C.currentTasksModel()).toEqual(next)
    await A.sendToTask('sigue')
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ sessionID: 's2', model: next }))
  })
  it('ignora otra carpeta, otro motor, sesiones desconocidas y payloads inválidos', () => {
    const state = C.useTasks.getState()
    apply(payload(), '/other')
    apply(payload('unknown'))
    for (const bad of [null, {}, { ...payload(), nuevo: { modelID: 'new' } }, { ...payload(), extra: true }]) apply(bad)
    S.setState({ sessionSource: { s1: 'main' } })
    apply()
    expect(C.useTasks.getState()).toBe(state)
  })
  it('no duplica eventos con el mismo id', () => {
    const ev = event(payload())
    C.handleEvent(ev, D)
    C.handleEvent(ev, D)
    expect(C.useTasks.getState().modelChanges.s1).toHaveLength(1)
  })
  it.each([true, false])('al reabrir usa el último usuario (sintético: %s), aunque en memoria haya otra elección', async (synthetic) => {
    C.setTaskModel(old)
    messages.mockResolvedValue({ data: history(synthetic) })
    await A.openTask('s1')
    expect(C.currentTasksModel()).toEqual(next)
    expect(C.currentTasksVariant()).toBeUndefined()
    await A.sendToTask('continúa')
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ model: next }))
  })
  it('recupera también la variante guardada en el mensaje del usuario', async () => {
    messages.mockResolvedValue({ data: history(true, 'high') })
    await A.openTask('s1')
    expect(C.currentTasksVariant()).toBe('high')
  })
  it.each(['event', 'manual'] as const)('un snapshot en vuelo no pisa una elección posterior (%s) ni cambia otra tarea', async (kind) => {
    let resolve!: (value: { data: MessageEntry[] }) => void
    messages.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const opening = A.openTask('s1')
    if (kind === 'event') apply()
    else {
      C.setTaskModel(next)
      C.setTaskVariant('high')
    }
    await A.openTask('s2')
    resolve({ data: history(true).slice(0, 1) })
    await opening
    expect(C.useTasks.getState().taskModel).toBeNull()
    expect(C.useTasks.getState().taskModels.s1).toEqual({ model: next, variant: kind === 'event' ? null : 'high' })
  })
  it('un evento durante la reapertura sigue visible al terminar el historial', async () => {
    let resolve!: (value: { data: MessageEntry[] }) => void
    messages.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r
        })
    )
    const opening = A.openTask('s1')
    apply()
    resolve({ data: history(true).slice(0, 1) })
    await opening
    expect(C.currentTasksModel()).toEqual(next)
  })
  it('la elección manual posterior manda en el siguiente envío', async () => {
    apply()
    C.setTaskModel(old)
    C.setTaskVariant('high')
    await A.sendToTask('dale')
    expect(promptAsync).toHaveBeenCalledWith(expect.objectContaining({ model: old, variant: 'high' }))
  })
  it('traduce la carpeta Windows a la ruta del motor antes de admitir el evento', () => {
    C.useTasks.setState({ folder: 'C:\\Work', conn: { ...C.useTasks.getState().conn!, folder: 'C:\\Work', directory: D } })
    apply()
    expect(C.currentTasksModel()).toEqual(next)
  })
  it('cerrar la carpeta limpia elecciones y avisos; una tarea nueva vuelve al modelo del modo', () => {
    apply()
    A.newTask()
    expect(C.useTasks.getState().taskModel).toBeNull()
    C.clearFolder()
    expect(C.useTasks.getState().taskModels).toEqual({})
    expect(C.useTasks.getState().modelChanges).toEqual({})
  })
})
