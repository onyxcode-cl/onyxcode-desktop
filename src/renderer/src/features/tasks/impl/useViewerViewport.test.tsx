// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'
const mock = vi.hoisted(() => ({ cw: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('./bridge', () => ({ cw: mock.cw }))
import { useViewerViewport } from './useViewerViewport'
let panel: Mounted | undefined
function Probe(): React.JSX.Element {
  const { hostRef, hasViewport } = useViewerViewport(true)
  return createElement('div', { ref: hostRef }, hasViewport ? 'superficie confirmada' : 'sin superficie')
}
beforeEach(() => {
  mock.cw.mockReset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 5, y: 10, width: 600, height: 400 } as DOMRect)
})
afterEach(() => {
  panel?.unmount()
  panel = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
it.each([true, false])('solo confirma la superficie cuando main confirma la ventana: %s', async (attached) => {
  mock.cw.mockResolvedValue(attached)
  panel = mount(createElement(Probe))
  await act(async () => {
    await Promise.resolve()
  })
  expect(panel.host.textContent).toBe(attached ? 'superficie confirmada' : 'sin superficie')
})
it('un error de attach no queda oculto como si la vista estuviera colocada', async () => {
  mock.cw.mockRejectedValue(new Error('IPC rechazado'))
  panel = mount(createElement(Probe))
  await act(async () => {
    await Promise.resolve()
  })
  expect(panel.host.textContent).toBe('sin superficie')
})
it('un panel oculto de cero píxeles no cuenta como superficie lista', async () => {
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ x: 0, y: 0, width: 0, height: 0 } as DOMRect)
  mock.cw.mockResolvedValue(true)
  panel = mount(createElement(Probe))
  await act(async () => {
    await Promise.resolve()
  })
  expect(panel.host.textContent).toBe('sin superficie')
})
