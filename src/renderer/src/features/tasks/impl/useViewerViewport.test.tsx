// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, type Mounted } from '../../../../../test/dom-render'
const mock = vi.hoisted(() => ({ cw: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('./bridge', () => ({ cw: mock.cw }))
import { useViewerViewport } from './useViewerViewport'
let panel: Mounted | undefined
function Probe({ ready = true }: { ready?: boolean }): React.JSX.Element {
  const { hostRef, hasViewport } = useViewerViewport(true, ready)
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
  vi.useRealTimers()
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
it('recupera un 0x0 inicial sin depender de otro resize y confirma el attach de tamaño real', async () => {
  vi.useFakeTimers()
  const measure = vi.mocked(HTMLElement.prototype.getBoundingClientRect)
  measure.mockReturnValueOnce({ x: 0, y: 0, width: 0, height: 0 } as DOMRect)
  mock.cw.mockResolvedValue(true)
  panel = mount(createElement(Probe))
  await act(() => vi.advanceTimersByTimeAsync(100))
  expect(panel.host.textContent).toBe('superficie confirmada')
  expect(mock.cw).toHaveBeenLastCalledWith('tasks:viewer:attach', {
    rect: { x: 5, y: 10, width: 600, height: 400 },
    visible: true
  })
  panel.unmount()
  panel = undefined
  expect(vi.getTimerCount()).toBe(0)
})
it('adjunta durante la carga y vuelve a medir al recibir listo aunque no haya resize', async () => {
  mock.cw.mockResolvedValue(true)
  panel = mount(createElement(Probe, { ready: false }))
  await act(async () => {
    await Promise.resolve()
  })
  expect(mock.cw).toHaveBeenLastCalledWith('tasks:viewer:attach', {
    rect: { x: 5, y: 10, width: 600, height: 400 },
    visible: true
  })
  vi.mocked(HTMLElement.prototype.getBoundingClientRect).mockReturnValue({ x: 5, y: 10, width: 650, height: 450 } as DOMRect)
  panel.rerender(createElement(Probe, { ready: true }))
  await act(async () => {
    await Promise.resolve()
  })
  expect(mock.cw).toHaveBeenLastCalledWith('tasks:viewer:attach', {
    rect: { x: 5, y: 10, width: 650, height: 450 },
    visible: true
  })
  expect(panel.host.textContent).toBe('superficie confirmada')
})
