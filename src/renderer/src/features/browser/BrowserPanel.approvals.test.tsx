// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../test/dom-render'
import type { BrowserOwnerState } from '@shared/ipc-browser'
const mock = vi.hoisted(() => ({
  state: {} as BrowserOwnerState,
  listeners: new Map<string, Set<(payload: any) => void>>(),
  br: vi.fn()
}))
vi.mock('./bridge', () => ({
  br: mock.br,
  onBrowser: (channel: string, fn: (payload: any) => void) => {
    const listeners = mock.listeners.get(channel) ?? new Set()
    mock.listeners.set(channel, listeners)
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
}))
vi.mock('./useNativeViewport', () => ({ useNativeViewport: () => ({ hostRef: null, shouldShowNative: false }) }))
import { BrowserPanel } from './BrowserPanel'
import { useAssignedOwner } from './useAssignedOwner'
import { useBrowserUi } from './store'
let panel: Mounted | null = null
afterEach(() => {
  panel?.unmount()
  panel = null
  mock.listeners.clear()
  mock.br.mockReset()
  useBrowserUi.setState({ approvals: {} })
})
const emit = (channel: string, payload: any) =>
  act(() => {
    mock.listeners.get(channel)?.forEach((fn) => fn(payload))
  })
it('al abrir el panel recupera y muestra la tarjeta que nació mientras estaba desmontado', async () => {
  const owner = { kind: 'tasks', folder: '/docs' } as const
  const req = {
    id: 'pending',
    owner,
    sessionId: 's1',
    kind: 'site',
    url: 'https://example.test',
    host: 'example.test',
    site: 'example.test',
    createdAt: Date.now() - 1000
  } as const
  mock.state = {
    owner,
    tabs: [],
    activeTabId: null,
    control: 'idle',
    agentSessionId: null,
    agentLabel: null,
    userActive: false,
    picking: false,
    hostedIn: 'none',
    viewMode: 'desktop',
    approvals: [req]
  }
  mock.br.mockImplementation(async (channel: string) => (channel === 'browser:state' ? mock.state : undefined))
  await act(async () => {
    panel = mount(createElement(BrowserPanel, { owner, product: 'tasks', visible: true, variant: 'popout' }))
  })
  expect(panel!.host.textContent).toContain('example.test')
  expect(panel!.host.textContent).toContain('Permitir siempre')
  expect(useBrowserUi.getState().approvals['tasks:/docs']).toEqual([req])
  expect(mock.br.mock.calls.some(([channel]) => channel === 'browser:respond')).toBe(false)
  emit('browser:approvalDone', { id: req.id })
  expect(panel!.host.textContent).not.toContain('example.test')
})
it('abrir una petición lleva la ventana reutilizada a su dueño, sin cambiarla por estados de otras carpetas', () => {
  function Owner() {
    const owner = useAssignedOwner()
    return createElement('span', null, owner?.kind === 'tasks' ? owner.folder : '')
  }
  panel = mount(createElement(Owner))
  emit('browser:state', { owner: { kind: 'tasks', folder: '/anterior' } })
  expect(panel.host.textContent).toBe('/anterior')
  emit('browser:reveal', { owner: { kind: 'tasks', folder: '/pendiente' }, reason: 'approval' })
  expect(panel.host.textContent).toBe('/pendiente')
  emit('browser:state', { owner: { kind: 'tasks', folder: '/otra' } })
  expect(panel.host.textContent).toBe('/pendiente')
})
