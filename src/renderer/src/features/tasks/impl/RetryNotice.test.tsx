// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('../../../lib/api', () => ({
  api: { invoke: vi.fn(), on: vi.fn(() => () => undefined), send: vi.fn() },
  call: vi.fn(async () => undefined)
}))

import { RetryNotice } from './RetryNotice'
import { StallNotice } from './StallNotice'
import { useTasks } from './store'
import { useSessions } from '../../../stores/sessions'
import { useRetryInfo } from '../../../lib/retry-info'

let host: HTMLDivElement
let root: Root

const statusEvent = (status: Record<string, unknown>, sessionID = 's1') =>
  ({ type: 'session.status', properties: { sessionID, status } }) as never

const fire = (e: never): void => {
  act(() => useSessions.getState().applyEvent(e))
}

const render = (el: React.ReactElement): string => {
  act(() => root.render(el))
  return host.textContent ?? ''
}

beforeEach(() => {
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useRetryInfo.setState({ bySession: {} })
  useSessions.setState({ status: {} })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  useTasks.setState({ activity: null } as never)
})

describe('RetryNotice: motivo en lugar de «Pensando…»', () => {
  it('429 del servicio gratuito: dice que se acabó y qué hacer, con el reductor real', () => {
    fire(statusEvent({ type: 'retry', attempt: 3, message: 'Free usage limit reached. Subscribe to OpenCode Go.', next: 1 }))
    const text = render(createElement(RetryNotice, { sessionId: 's1' }))
    expect(text).toContain('Se acabó el uso gratuito')
    expect(text).toContain('Ajustes › Modelos')
    expect(text).toContain('(intento 3)')
    expect(text).toContain('no se colgó')
    expect(text).not.toContain('Pensando')
  })

  it('error de red: causa y consejo propios', () => {
    fire(statusEvent({ type: 'retry', attempt: 1, message: 'fetch failed ECONNRESET', next: 1 }))
    const text = render(createElement(RetryNotice, { sessionId: 's1' }))
    expect(text).toContain('Sin conexión con el modelo')
    expect(text).toContain('Revisa tu internet')
  })

  it('mensaje vacío: aviso genérico, sin «undefined» ni vacío', () => {
    fire(statusEvent({ type: 'retry', attempt: 1, message: '', next: 1 }))
    const text = render(createElement(RetryNotice, { sessionId: 's1' }))
    expect(text).toContain('El modelo no responde')
    expect(text).not.toContain('undefined')
  })

  it('al volver a ocupado desaparece', () => {
    fire(statusEvent({ type: 'retry', attempt: 1, message: 'x', next: 1 }))
    expect(render(createElement(RetryNotice, { sessionId: 's1' }))).not.toBe('')
    fire(statusEvent({ type: 'busy' }))
    expect(render(createElement(RetryNotice, { sessionId: 's1' }))).toBe('')
  })

  it('«Sin actividad» no contradice: se oculta mientras reintenta y vuelve al terminar', () => {
    useTasks.setState({ activity: { tasks: [{ sessionId: 's1', quietSince: Date.now() - 11 * 60_000 }] } } as never)
    fire(statusEvent({ type: 'busy' }))
    expect(render(createElement(StallNotice, { taskId: 's1' }))).toContain('Sin actividad')
    fire(statusEvent({ type: 'retry', attempt: 1, message: 'x', next: 1 }))
    expect(render(createElement(StallNotice, { taskId: 's1' }))).toBe('')
  })
})
