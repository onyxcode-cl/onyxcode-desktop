// @vitest-environment jsdom
/**
 * Tareas: permisos y preguntas de un AYUDANTE (sesión hija). Se ven en la tarea raíz rotulados con su nombre, sin «Siempre»;
 * «Siempre» desde una hija no guarda reglas de la carpeta; la tarea cuenta como «trabajando» mientras sus ayudantes de fondo
 * trabajan; Detener la tarea detiene también a los ayudantes; una tarea sin hijas se comporta como antes.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionRequest } from '@opencode-ai/sdk/v2/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const cw = vi.hoisted(() => vi.fn((..._a: unknown[]) => Promise.resolve([] as unknown)))
vi.mock('./bridge', async (orig) => ({ ...(await orig<typeof import('./bridge')>()), cw }))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const FOLDER = '/proj'
const NOW = Date.now()
const sess = (id: string, parentID?: string): never =>
  ({ id, parentID, title: id, directory: FOLDER, time: { created: NOW, updated: NOW } }) as never
const taskPart = {
  id: 'p1',
  sessionID: 'root',
  messageID: 'm1',
  type: 'tool',
  callID: 'c1',
  tool: 'task',
  state: { status: 'completed', input: { description: 'Revisar logs' }, metadata: { sessionId: 'kid', background: true } }
}
const perm = (sessionID: string, over: Partial<PermissionRequest> = {}): PermissionRequest =>
  ({
    id: `perm_${sessionID}`,
    sessionID,
    permission: 'bash',
    patterns: ['npm run build'],
    metadata: { command: 'npm run build' },
    always: ['npm run build'],
    ...over
  }) as PermissionRequest

let S: typeof import('../../../stores/sessions')
let C: typeof import('./store')
let A: typeof import('./actions')
let PP: typeof import('./PermissionPrompt')
let Q: typeof import('./QuestionPrompt')
let H: typeof import('./useTaskStatusOf')
let host: HTMLDivElement
let root: Root
const reply = vi.fn((..._a: unknown[]) => Promise.resolve({ data: true }))
const abort = vi.fn((..._a: unknown[]) => Promise.resolve({ data: true }))

beforeEach(async () => {
  vi.unstubAllGlobals()
  vi.stubGlobal('navigator', { userAgent: 'test', language: 'es', languages: ['es'] })
  vi.resetModules()
  localStorage.clear()
  cw.mockClear()
  reply.mockClear()
  abort.mockClear()
  ;(await import('@shared/i18n')).setLang('es')
  S = await import('../../../stores/sessions')
  C = await import('./store')
  A = await import('./actions')
  PP = await import('./PermissionPrompt')
  Q = await import('./QuestionPrompt')
  H = await import('./useTaskStatusOf')
  ;(window as unknown as { api: { platform: string } }).api = { platform: 'darwin' }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  S.useSessions.setState({
    sessions: { root: sess('root'), kid: sess('kid', 'root') },
    messages: { root: [{ info: { id: 'm1' } as never, parts: [taskPart as never] }] },
    status: {},
    errors: {}
  })
  C.useTasks.setState({
    folder: FOLDER,
    activeTaskId: 'root',
    client: { permission: { reply }, session: { abort } } as never,
    conn: { folder: FOLDER, directory: FOLDER, pathMap: { kind: 'identity' }, baseUrl: 'http://cw1', fullAccess: false } as never
  })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { api?: unknown }).api
})

describe('permiso de un ayudante en Tareas', () => {
  it('la tarjeta lo rotula con el nombre del ayudante y no ofrece «Siempre»', () => {
    act(() => root.render(createElement(PP.PermissionCard, { request: perm('kid') })))
    expect(host.textContent).toContain('Ayudante «Revisar logs»')
    expect(host.textContent).not.toMatch(/Siempre/i)
    expect(host.textContent).toContain('Permitir una vez')
  })

  it('la de la propia tarea queda como siempre (sin rótulo de ayudante)', () => {
    act(() => root.render(createElement(PP.PermissionCard, { request: perm('root') })))
    expect(host.textContent).not.toContain('Ayudante')
  })

  it('responder llama al motor con el id y la carpeta del permiso de la hija', async () => {
    await A.replyPermission('perm_kid', 'once')
    expect(reply).toHaveBeenCalledWith({ requestID: 'perm_kid', directory: FOLDER, reply: 'once' })
  })

  it('«Siempre» desde una hija se responde «una vez» y NO guarda ninguna regla de la carpeta', async () => {
    await A.replyPermissionAlways(perm('kid'))
    expect(reply).toHaveBeenCalledTimes(1)
    expect(reply.mock.calls[0]![0]).toMatchObject({ requestID: 'perm_kid', reply: 'once' })
    expect(cw).not.toHaveBeenCalledWith('tasks:rules:add', expect.anything())
  })

  it('«Siempre» desde la propia tarea sigue guardando la regla (sin cambios)', async () => {
    await A.replyPermissionAlways(perm('root'))
    expect(reply.mock.calls[0]![0]).toMatchObject({ requestID: 'perm_root', reply: 'always' })
    expect(cw).toHaveBeenCalledWith('tasks:rules:add', expect.objectContaining({ folder: FOLDER, permission: 'bash' }))
  })

  it('la pregunta de un ayudante lleva su rótulo', () => {
    const req = { id: 'q1', sessionID: 'kid', questions: [] } as never
    act(() => root.render(createElement(Q.QuestionCard, { request: req })))
    expect(host.textContent).toContain('Pregunta del ayudante «Revisar logs»')
  })

  it('el aviso de aprobación de una hija dice «ayudante» y abre la tarea raíz', async () => {
    const notify = await import('../../../lib/notify')
    C.handleEvent({ type: 'permission.asked', properties: perm('kid') } as never, FOLDER)
    expect(notify.sendNotification).toHaveBeenCalledWith(
      'Un ayudante de una tarea necesita tu aprobación',
      'root',
      expect.objectContaining({ mode: 'tasks', id: 'root' })
    )
  })
})

describe('«trabajando» de la tarea con ayudantes en segundo plano', () => {
  function StatusProbe(): React.JSX.Element {
    const statusOf = H.useTaskStatusOf()
    return createElement('span', null, statusOf(S.useSessions.getState().sessions['root'] as never))
  }

  it('la tarea en reposo con una hija de fondo trabajando figura «running»', () => {
    S.useSessions.setState({ status: { root: 'idle', kid: 'busy' } })
    act(() => root.render(createElement(StatusProbe)))
    expect(host.textContent).toBe('running')
  })

  it('sin hijas (o con la hija en reposo) el estado es el de siempre', () => {
    S.useSessions.setState({ status: { root: 'idle', kid: 'idle' } })
    act(() => root.render(createElement(StatusProbe)))
    expect(host.textContent).not.toBe('running')
    act(() => S.useSessions.setState({ sessions: { root: sess('root') }, messages: {}, status: { root: 'idle' } }))
    act(() => root.render(createElement(StatusProbe)))
    expect(host.textContent).not.toBe('running')
  })

  it('Detener la tarea detiene también a la hija viva, cada una con su sesión', async () => {
    S.useSessions.setState({ status: { root: 'busy', kid: 'busy' } })
    await A.abortTask()
    expect(abort.mock.calls.map((c) => (c[0] as { sessionID: string }).sessionID)).toEqual(['root', 'kid'])
  })

  it('Detener una tarea sin hijas aborta solo esa sesión', async () => {
    S.useSessions.setState({ sessions: { root: sess('root') }, messages: {}, status: { root: 'busy' } })
    await A.abortTask()
    expect(abort).toHaveBeenCalledTimes(1)
  })
})
