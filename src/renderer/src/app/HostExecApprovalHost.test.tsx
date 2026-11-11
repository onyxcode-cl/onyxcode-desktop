// @vitest-environment jsdom
/** Tarjeta de `equipo`: muestra el comando completo, «No» tiene el foco, «Permitir esta vez» se arma tras 1,5 s, Esc deniega. */
import '../../../test/jsdom-first' // debe ir ANTES de react-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HostExecApprovalRequest } from '@shared/ipc-tasks'

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
    return ch === 'tasks:hostExec:pending' ? [] : undefined
  })
}))

import { HOST_ALLOW_DELAY_MS, HostExecApprovalHost, hostApprovalView } from './HostExecApprovalHost'

const REQ: HostExecApprovalRequest = {
  id: 'abcd1234abcd1234',
  folder: '/Users/ben/proyecto',
  command: 'open "/Users/ben/Documents/un archivo muy largo con espacios.pdf" && echo listo',
  reason: 'Abrir el PDF que pediste.',
  background: false,
  timeoutS: 60,
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

describe('hostApprovalView', () => {
  it('«Permitir esta vez» solo tras el margen; cuenta regresiva y vencimiento', () => {
    expect(hostApprovalView(REQ, 0, HOST_ALLOW_DELAY_MS - 1).canAllow).toBe(false)
    expect(hostApprovalView(REQ, 0, HOST_ALLOW_DELAY_MS).canAllow).toBe(true)
    expect(hostApprovalView(REQ, 0, REQ.expiresAt).expired).toBe(true)
    expect(hostApprovalView(REQ, 0, REQ.expiresAt - 2500).secondsLeft).toBe(3)
  })
})

describe('HostExecApprovalHost', () => {
  it('muestra el comando completo, el motivo y la carpeta; sin «siempre»; Esc deniega', async () => {
    await act(async () => root.render(createElement(HostExecApprovalHost)))
    expect(invoked.map((x) => x.ch)).toContain('tasks:hostExec:pending')
    await act(async () => listeners.get('tasks:hostExec:approval')?.(REQ))
    const pre = document.querySelector('[data-host-exec-command]')
    expect(pre?.textContent).toBe(REQ.command)
    expect(document.body.textContent).toContain(REQ.reason)
    expect(document.body.textContent).toContain(REQ.folder)
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/siempre|always/)
    const buttons = [...document.querySelectorAll('[data-host-exec-approval] button')] as HTMLButtonElement[]
    expect(buttons).toHaveLength(2)
    expect(document.activeElement).toBe(buttons[0])
    expect(buttons[1]!.disabled).toBe(true)
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(invoked.at(-1)).toEqual({ ch: 'tasks:hostExec:respond', req: { id: REQ.id, decision: 'deny' } })
    expect(document.querySelector('[data-host-exec-approval]')).toBeNull()
  })

  it('tras el margen, «Permitir esta vez» responde allow para ESA id; `approvalDone` cierra la tarjeta', async () => {
    vi.useFakeTimers()
    await act(async () => root.render(createElement(HostExecApprovalHost)))
    await act(async () => listeners.get('tasks:hostExec:approval')?.(REQ))
    await act(async () => {
      vi.advanceTimersByTime(HOST_ALLOW_DELAY_MS + 300)
    })
    const allow = [...document.querySelectorAll('[data-host-exec-approval] button')][1] as HTMLButtonElement
    expect(allow.disabled).toBe(false)
    await act(async () => allow.click())
    expect(invoked.at(-1)).toEqual({ ch: 'tasks:hostExec:respond', req: { id: REQ.id, decision: 'allow' } })

    await act(async () => listeners.get('tasks:hostExec:approval')?.({ ...REQ, id: 'eeee' }))
    expect(document.querySelector('[data-host-exec-approval]')).not.toBeNull()
    await act(async () => listeners.get('tasks:hostExec:approvalDone')?.({ id: 'eeee' }))
    expect(document.querySelector('[data-host-exec-approval]')).toBeNull()
  })
})
