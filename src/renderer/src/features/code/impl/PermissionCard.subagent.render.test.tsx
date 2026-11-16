// @vitest-environment jsdom
/**
 * Tarjetas de permiso y de pregunta de Code cuando las pide un AYUDANTE (sesión hija): se ven en la conversación raíz,
 * rotuladas con su nombre, sin «Permitir siempre»; la de la propia raíz queda como siempre. Escritorio y celular.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PermissionCard, QuestionCard } from './PermissionCard'
import { useCode } from './store'
import { useProviders } from '../../../stores/providers'
import { useLang } from '../../../lib/i18n'
import type { PendingPermission, PendingQuestion } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const NOW = Date.now()
const sess = (id: string, parentID?: string): never => ({ id, parentID, title: id, time: { created: NOW, updated: NOW } }) as never
const taskPart = {
  id: 'p1',
  sessionID: 'root',
  messageID: 'm1',
  type: 'tool',
  callID: 'c1',
  tool: 'task',
  state: {
    status: 'completed',
    input: { description: 'Revisar logs', subagent_type: 'explore' },
    metadata: { sessionId: 'kid', background: true }
  }
}

const perm = (sessionID: string, over: Partial<PendingPermission> = {}): PendingPermission => ({
  id: `perm_${sessionID}`,
  sessionID,
  permission: 'bash',
  patterns: ['npm run build'],
  metadata: { command: 'npm run build' },
  always: ['npm run build'],
  api: 'v1',
  ...over
})

let host: HTMLDivElement
let root: Root
const setPlatform = (platform: string): void => {
  ;(window as unknown as { api: { platform: string } }).api = { platform }
}
const paint = (node: React.ReactElement): void => act(() => root.render(node))

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('navigator', { userAgent: 'test', language: 'es', languages: ['es'] })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  setPlatform('darwin')
  useCode.setState({
    sessions: { root: sess('root'), kid: sess('kid', 'root') },
    activeSessionID: 'root',
    messages: { root: [{ info: { id: 'm1' } as never, parts: [taskPart as never] }] }
  })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { api?: unknown }).api
})

describe('permiso de un ayudante (escritorio)', () => {
  it('lo rotula con el nombre del ayudante y no ofrece «Permitir siempre»', () => {
    paint(createElement(PermissionCard, { request: perm('kid'), root: '/proj' }))
    expect(host.textContent).toContain('El ayudante «Revisar logs» pide permiso para ejecutar un comando')
    expect(host.textContent).not.toContain('no volver a preguntar')
    expect(host.textContent).toContain('No')
    expect(host.textContent).toContain('Permitir')
  })

  it('el de la propia raíz queda como siempre: «El agente quiere…» y con «Permitir siempre»', () => {
    paint(createElement(PermissionCard, { request: perm('root'), root: '/proj' }))
    expect(host.textContent).toContain('El agente quiere ejecutar un comando')
    expect(host.textContent).not.toContain('El ayudante')
    expect(host.textContent).toContain('no volver a preguntar')
  })

  it('sin nombre conocido dice «Un ayudante…»', () => {
    useCode.setState({ messages: {}, sessions: { root: sess('root'), kid: { ...(sess('kid', 'root') as object), title: '' } as never } })
    paint(createElement(PermissionCard, { request: perm('kid'), root: '/proj' }))
    expect(host.textContent).toContain('Un ayudante pide permiso para ejecutar un comando')
  })
})

describe('permiso de un ayudante (celular)', () => {
  it('mismo rótulo y solo «una vez» / «rechazar»', () => {
    setPlatform('remote')
    paint(createElement(PermissionCard, { request: perm('kid', { permission: 'webfetch', metadata: {} }), root: '/proj' }))
    expect(host.textContent).toContain('El ayudante «Revisar logs» pide permiso para acceder a una URL')
    expect(host.textContent).not.toContain('no volver a preguntar')
  })
})

describe('pregunta de un ayudante', () => {
  const q = (sessionID: string): PendingQuestion => ({ id: `q_${sessionID}`, sessionID, questions: [] })
  it('lleva el rótulo del ayudante; la de la raíz no', () => {
    paint(createElement(QuestionCard, { request: q('kid') }))
    expect(host.textContent).toContain('Pregunta del ayudante «Revisar logs»')
    paint(createElement(QuestionCard, { request: q('root') }))
    expect(host.textContent).not.toContain('Pregunta del ayudante')
  })
})

it('V31: la tarjeta usa el encargo actual de un ayudante reusado y traduce su rol de reserva', () => {
  const reused = { ...taskPart, state: { ...taskPart.state, input: { task_id: 'kid', description: 'Borrar borrador' }, metadata: {} } }
  useCode.setState({ messages: { root: [{ info: { id: 'm1' } as never, parts: [taskPart as never, reused as never] }] } })
  paint(createElement(PermissionCard, { request: perm('kid'), root: '/proj' }))
  expect(host.textContent).toContain('El ayudante «Borrar borrador»')
  expect(host.textContent).not.toContain('Revisar logs')
  useCode.setState({
    messages: {
      root: [
        {
          info: { id: 'm1' } as never,
          parts: [{ ...taskPart, state: { ...taskPart.state, input: { subagent_type: 'explore' } } } as never]
        }
      ]
    }
  })
  paint(createElement(PermissionCard, { request: perm('kid'), root: '/proj' }))
  expect(host.textContent).toContain('Ayudante (solo lectura)')
  expect(host.textContent).not.toContain('explore')
})

it('V31: el permiso del ayudante acompaña el nombre con el modelo visible en ambos idiomas', () => {
  const providers = useProviders.getState().providers
  useProviders.setState({ providers: [{ id: 'p', models: { modelo: { name: 'Modelo visible' } } }] as never })
  useCode.setState((s) => ({
    messages: { ...s.messages, kid: [{ info: { id: 'a', role: 'assistant', providerID: 'p', modelID: 'modelo' } as never, parts: [] }] }
  }))
  for (const [lang, label] of [
    ['es', 'Modelo: Modelo visible'],
    ['en', 'Model: Modelo visible']
  ] as const) {
    act(() => useLang.setState({ lang }))
    paint(createElement(PermissionCard, { request: perm('kid'), root: '/proj' }))
    expect(host.textContent).toContain(label)
    expect(host.textContent).not.toContain('p/modelo')
  }
  act(() => {
    useLang.setState({ lang: 'es' })
    useProviders.setState({ providers })
  })
})
