// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '../../../../../test/dom-render'
const mock = vi.hoisted(() => ({
  theme: 'dark',
  viewport: true,
  overlay: false,
  listener: null as null | ((e: any) => void),
  cw: vi.fn<(...args: any[]) => Promise<any>>(() => new Promise(() => undefined))
}))
vi.mock('./bridge', () => ({
  cw: mock.cw,
  onTasks: (_: string, cb: (e: any) => void) => {
    mock.listener = cb
    return () => {
      mock.listener = null
    }
  }
}))
vi.mock('../../../lib/useAppTheme', () => ({ useAppTheme: () => mock.theme }))
vi.mock('../../../lib/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('../../../lib/opencode', () => ({ errorMessage: String }))
vi.mock('./useViewerViewport', () => ({
  useViewerViewport: (visible: boolean) => ({ hostRef: null, shouldShowNative: visible && !mock.overlay, hasViewport: mock.viewport })
}))
import { DocumentViewerPanel } from './DocumentViewerPanel'
let panel: Mounted | null = null
afterEach(() => {
  panel?.unmount()
  panel = null
  mock.cw.mockReset()
  mock.cw.mockImplementation(() => new Promise(() => undefined))
  mock.viewport = true
  mock.overlay = false
  vi.useRealTimers()
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

const element = () => createElement(DocumentViewerPanel, { path: 'C:\\Trabajo\\a.docx', visible: true, onClose: () => undefined })
it('a los 8 s sin respuesta muestra el motivo, cierra la vista y permite abrir en el sistema', async () => {
  vi.useFakeTimers()
  let done!: (value: unknown) => void
  mock.cw.mockImplementation((channel) =>
    channel === 'tasks:viewer:open'
      ? new Promise((r) => {
          done = r
        })
      : Promise.resolve()
  )
  panel = mount(element())
  const first = mock.cw.mock.calls[0][1]
  await act(() => vi.advanceTimersByTimeAsync(8000))
  expect(panel.host.textContent).toContain('viewer.timeout')
  expect(mock.cw).toHaveBeenCalledWith('tasks:viewer:close', { openingId: first.openingId, reason: 'timeout' })
  click(panel.qa('button').find((b) => b.textContent?.includes('viewer.openSystem'))!)
  expect(mock.cw).toHaveBeenCalledWith('tasks:openPath', { path: 'C:\\Trabajo\\a.docx' })
  await act(async () => {
    done({ ok: true, mode: 'web' })
    await Promise.resolve()
  })
  expect(panel.host.textContent).toContain('viewer.timeout')
})
it.each(['web', 'classic'])('una respuesta %s a tiempo conserva el estado e identifica el visor', async (mode) => {
  vi.useFakeTimers()
  mock.cw.mockResolvedValue({ ok: true, mode })
  panel = mount(element())
  await act(async () => {
    await Promise.resolve()
  })
  await act(() => vi.advanceTimersByTimeAsync(8000))
  expect(panel.host.textContent).toContain(mode === 'web' ? 'viewer.ready' : 'viewer.fallback')
  expect(panel.host.textContent).not.toContain('viewer.timeout')
})
it('aunque la carga responda, un hueco de tamaño cero termina con aviso', async () => {
  vi.useFakeTimers()
  mock.viewport = false
  mock.cw.mockResolvedValue({ ok: true, mode: 'web' })
  panel = mount(element())
  await act(() => vi.advanceTimersByTimeAsync(8000))
  expect(panel.host.textContent).toContain('viewer.timeout')
})
it('un 0x0 inicial recuperado después de cargar no cierra Word ni Excel a los 8 s', async () => {
  vi.useFakeTimers()
  mock.viewport = false
  mock.cw.mockResolvedValue({ ok: true, mode: 'web' })
  panel = mount(element())
  await act(() => vi.advanceTimersByTimeAsync(1000))
  mock.viewport = true
  panel.rerender(element())
  await act(() => vi.advanceTimersByTimeAsync(10_000))
  expect(panel.host.textContent).toContain('viewer.ready')
  expect(mock.cw).not.toHaveBeenCalledWith('tasks:viewer:close', expect.objectContaining({ reason: 'timeout' }))
})
it.each(['oculto', 'diálogo'])(
  'no destruye una vista lista con el panel %s; al mostrarlo conserva la protección contra un blanco real',
  async (cause) => {
    vi.useFakeTimers()
    mock.viewport = false
    mock.overlay = cause === 'diálogo'
    mock.cw.mockResolvedValue({ ok: true, mode: 'web' })
    panel = mount(createElement(DocumentViewerPanel, { path: '/docs/a.docx', visible: cause !== 'oculto', onClose: () => undefined }))
    await act(() => vi.advanceTimersByTimeAsync(10_000))
    expect(panel.host.textContent).not.toContain('viewer.timeout')
    mock.overlay = false
    panel.rerender(createElement(DocumentViewerPanel, { path: '/docs/a.docx', visible: true, onClose: () => undefined }))
    await act(() => vi.advanceTimersByTimeAsync(8000))
    expect(panel.host.textContent).toContain('viewer.timeout')
  }
)
it('un error IPC muestra aviso y botón', async () => {
  mock.cw.mockRejectedValue(new Error('fallo'))
  panel = mount(element())
  await act(async () => {
    await Promise.resolve()
  })
  expect(panel.host.textContent).toContain('merr.viewer.openFailed')
  expect(panel.host.textContent).toContain('viewer.openSystem')
})
it('una caída del visor listo se comunica; un evento de otra apertura se ignora', async () => {
  mock.cw.mockResolvedValue({ ok: true, mode: 'web' })
  panel = mount(element())
  await act(async () => {
    await Promise.resolve()
  })
  act(() => mock.listener?.({ type: 'crashed', openingId: 'viejo' }))
  expect(panel.host.textContent).toContain('viewer.ready')
  const { openingId } = mock.cw.mock.calls[0][1]
  act(() => mock.listener?.({ type: 'crashed', openingId }))
  expect(panel.host.textContent).toContain('merr.viewer.openFailed')
})
