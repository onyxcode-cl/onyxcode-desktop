// @vitest-environment jsdom
/** Tarjeta de conector: datos completos, «No» con el foco, tres botones (sin «siempre»), «en esta tarea» responde `task`. */
import '../../../test/jsdom-first' // debe ir ANTES de react-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConnectorApprovalRequest } from '@shared/ipc-tasks'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const listeners = new Map<string, (p: unknown) => void>()
const invoked: Array<{ ch: string; req: unknown }> = []
vi.mock('../features/tasks/impl/bridge', () => ({
  hasTasksBridge: () => true,
  onTasks: (ch: string, fn: (p: unknown) => void) => {
    listeners.set(ch, fn)
    return () => listeners.delete(ch)
  },
  cw: vi.fn(async (ch: string, req?: unknown) => {
    invoked.push({ ch, req })
    return ch === 'tasks:connector:pending' ? [] : undefined
  })
}))

import { ConnectorApprovalHost } from './ConnectorApprovalHost'
import { HOST_ALLOW_DELAY_MS } from './HostExecApprovalHost'

const REQ: ConnectorApprovalRequest = {
  id: 'abcd1234abcd1234',
  folder: '/Users/ana/proyecto',
  server: 'gmail',
  tool: 'send_email',
  args: '{\n  "to": "ana@example.com",\n  "asunto": "Informe"\n}',
  createdAt: Date.now(),
  expiresAt: Date.now() + 300_000
}

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  listeners.clear()
  invoked.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.useRealTimers()
})

describe('ConnectorApprovalHost', () => {
  it('muestra conector, herramienta y datos completos; «No» con el foco; sin «siempre»; Esc deniega', async () => {
    await act(async () => root.render(createElement(ConnectorApprovalHost)))
    await act(async () => listeners.get('tasks:connector:approval')?.(REQ))
    expect(document.querySelector('[data-connector-server]')?.textContent).toBe('gmail')
    expect(document.querySelector('[data-connector-tool]')?.textContent).toBe('send_email')
    expect(document.querySelector('[data-connector-args]')?.textContent).toBe(REQ.args)
    const buttons = [...document.querySelectorAll('[data-connector-approval] button')] as HTMLButtonElement[]
    expect(buttons).toHaveLength(3)
    expect(buttons.map((b) => b.textContent?.toLowerCase()).join(' ')).not.toMatch(/siempre|always/)
    expect(document.activeElement).toBe(buttons[0])
    expect(buttons[1]!.disabled && buttons[2]!.disabled).toBe(true)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(invoked.at(-1)).toEqual({ ch: 'tasks:connector:respond', req: { id: REQ.id, decision: 'deny' } })
  })

  it('tras el margen, «Permitir en esta tarea» responde `task` para ESA id', async () => {
    vi.useFakeTimers()
    await act(async () => root.render(createElement(ConnectorApprovalHost)))
    await act(async () => listeners.get('tasks:connector:approval')?.(REQ))
    await act(async () => {
      vi.advanceTimersByTime(HOST_ALLOW_DELAY_MS + 300)
    })
    const task = [...document.querySelectorAll('[data-connector-approval] button')][1] as HTMLButtonElement
    expect(task.disabled).toBe(false)
    await act(async () => task.click())
    expect(invoked.at(-1)).toEqual({ ch: 'tasks:connector:respond', req: { id: REQ.id, decision: 'task' } })
  })
})
