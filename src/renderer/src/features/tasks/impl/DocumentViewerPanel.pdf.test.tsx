// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'

const mock = vi.hoisted(() => ({ cw: vi.fn<(...args: unknown[]) => Promise<unknown>>() }))
vi.mock('./bridge', () => ({ cw: mock.cw, onTasks: () => () => undefined }))
vi.mock('../../../lib/useAppTheme', () => ({ useAppTheme: () => 'light' }))
vi.mock('../../../lib/i18n', () => ({ useT: () => (key: string) => key }))
import { DocumentViewerPanel } from './DocumentViewerPanel'

let panel: Mounted | undefined
beforeEach(() => {
  mock.cw.mockReset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 730, y: 136, width: 559, height: 662 } as DOMRect)
})
afterEach(() => {
  panel?.unmount()
  panel = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it.each(['/docs/informe.pdf', 'C:\\Trabajo\\informe.pdf'])(
  'el PDF de respaldo %s activa el hook real y deja libre el hueco',
  async (path) => {
    let loaded!: (result: unknown) => void
    mock.cw.mockImplementation((channel) =>
      channel === 'tasks:viewer:open'
        ? new Promise((resolve) => {
            loaded = resolve
          })
        : Promise.resolve(true)
    )
    panel = mount(createElement(DocumentViewerPanel, { path, visible: true, onClose: () => undefined }))
    await act(async () => {
      await Promise.resolve()
    })
    const rect = { x: 730, y: 136, width: 559, height: 662 }
    // La superficie se adjunta antes de que responda la apertura.
    expect(mock.cw).toHaveBeenCalledWith('tasks:viewer:attach', { rect, visible: true })
    await act(async () => {
      loaded({ ok: true, kind: 'pdf', mode: 'classic' })
      await Promise.resolve()
    })
    expect(mock.cw).toHaveBeenLastCalledWith('tasks:viewer:attach', { rect, visible: true })
    expect(panel.host.querySelector('[role="status"]')?.textContent).toContain('viewer.fallback')
    // El estado vive en la fila anterior: el hueco nativo listo no contiene texto ni overlay.
    const nativeHost = panel.host.firstElementChild?.lastElementChild
    expect(nativeHost?.childElementCount).toBe(0)
    expect(nativeHost?.textContent).toBe('')
  }
)
