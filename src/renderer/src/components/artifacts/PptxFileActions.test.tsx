// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '../../../../test/dom-render'
const mock = vi.hoisted(() => ({ invoke: vi.fn(), task: vi.fn(), view: vi.fn(), remote: false }))
vi.mock('../../lib/extrasApi', () => ({ getExtras: () => ({ invoke: mock.invoke }) }))
vi.mock('../../lib/platform', async (original) => ({
  ...(await original<typeof import('../../lib/platform')>()),
  isRemoteSurface: () => mock.remote
}))
vi.mock('../../lib/chatFileView', () => ({ viewChatFile: mock.view }))
vi.mock('../../features/tasks/impl/bridge', () => ({ cw: mock.task }))
import { PptxFileActions } from './PptxFileActions'
let view: Mounted | null = null
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mock.remote = false
  mock.view.mockReturnValue(true)
  mock.invoke.mockResolvedValue({ path: '/private/a.pptx', name: 'a.pptx' })
  mock.task.mockResolvedValue(undefined)
})
afterEach(() => view?.unmount())
it('adjunto: importa bytes antes de Ver; Presentar utiliza la copia privada', async () => {
  view = mount(createElement(PptxFileActions, { source: { kind: 'attachment', name: 'a.pptx', base64: 'UEsDBA==' } }))
  click(view.host.querySelector('[aria-label="Ver"]')!)
  await flush()
  expect(mock.invoke).toHaveBeenCalledWith('extras:importPptx', { name: 'a.pptx', base64: 'UEsDBA==' })
  expect(mock.view).toHaveBeenCalledWith(expect.objectContaining({ path: '/private/a.pptx' }))
  click(view.host.querySelector('[aria-label="Presentar"]')!)
  await flush()
  expect(mock.invoke).toHaveBeenCalledWith('extras:presentPptx', { path: '/private/a.pptx' })
})
it('Tareas: Ver usa su propio panel y Presentar su canal; no amplía el ámbito del Chat', async () => {
  const onView = vi.fn()
  view = mount(createElement(PptxFileActions, { source: { kind: 'tasks', path: '/tasks/a.pptx' }, onView }))
  click(view.host.querySelector('[aria-label="Ver"]')!)
  await flush()
  expect(onView).toHaveBeenCalledOnce()
  click(view.host.querySelector('[aria-label="Presentar"]')!)
  await flush()
  expect(mock.task).toHaveBeenCalledWith('tasks:presentPptx', { path: '/tasks/a.pptx' })
  expect(mock.invoke).not.toHaveBeenCalled()
})
it('muestra error del render sin silenciar la lámina faltante', async () => {
  mock.invoke.mockRejectedValueOnce(new Error('No se pudo representar la lámina 3.'))
  view = mount(createElement(PptxFileActions, { source: { kind: 'chat', path: '/chat/a.pptx' } }))
  click(view.host.querySelector('[aria-label="Presentar"]')!)
  await flush()
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain('lámina 3')
})
it('no ofrece ventanas ni importa bytes desde la superficie remota', () => {
  mock.remote = true
  view = mount(createElement(PptxFileActions, { source: { kind: 'chat', path: '/a.pptx' } }))
  expect(view.host.querySelector('button')).toBeNull()
})

it.each(['chat', 'tasks'] as const)('%s: cancelar pantalla libera Presentar sin error y permite reintentar', async (kind) => {
  let cancel!: () => void
  const present = kind === 'tasks' ? mock.task : mock.invoke
  present.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        cancel = resolve
      })
  )
  view = mount(createElement(PptxFileActions, { source: { kind, path: '/work/deck.pptx' } }))
  const button = view.host.querySelector<HTMLButtonElement>('[aria-label="Presentar"]')!
  click(button)
  expect(button.disabled).toBe(true)
  expect(button.querySelector('.animate-spin')).not.toBeNull()
  await act(async () => cancel())
  expect(button.disabled).toBe(false)
  expect(button.querySelector('.animate-spin')).toBeNull()
  expect(view.host.querySelector('[role="alert"]')).toBeNull()
  click(button)
  expect(present).toHaveBeenCalledTimes(2)
  await act(async () => cancel())
})
