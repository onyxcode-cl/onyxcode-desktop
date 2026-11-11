// @vitest-environment jsdom
import { createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'
const mock = vi.hoisted(() => ({ theme: 'dark', cw: vi.fn(() => new Promise(() => undefined)) }))
vi.mock('./bridge', () => ({ cw: mock.cw }))
vi.mock('../../../lib/useAppTheme', () => ({ useAppTheme: () => mock.theme }))
vi.mock('../../../lib/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('../../../lib/opencode', () => ({ errorMessage: String }))
vi.mock('./useViewerViewport', () => ({ useViewerViewport: () => ({ hostRef: null, shouldShowNative: true }) }))
import { DocumentViewerPanel } from './DocumentViewerPanel'
let panel: Mounted | null = null
afterEach(() => {
  panel?.unmount()
  panel = null
  mock.cw.mockClear()
  mock.theme = 'dark'
})
it('cambiar de tema mientras carga cierra solo el id anterior; desmontar cierra el nuevo', () => {
  const element = () => createElement(DocumentViewerPanel, { path: '/docs/a.docx', visible: true, onClose: () => undefined })
  panel = mount(element())
  const first = (mock.cw.mock.calls as unknown[][])[0]![1] as { openingId: string }
  expect(first.openingId).toMatch(/^[0-9a-f-]{36}$/)
  mock.theme = 'light'
  panel.rerender(element())
  const calls = mock.cw.mock.calls as unknown[][]
  expect(calls[1]).toEqual(['tasks:viewer:close', { openingId: first.openingId }])
  const second = calls[2]![1] as { openingId: string; theme: string }
  expect(second.openingId).not.toBe(first.openingId)
  expect(second.theme).toBe('light')
  panel.unmount()
  panel = null
  expect(calls[3]).toEqual(['tasks:viewer:close', { openingId: second.openingId }])
})
