// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { TasksDeliverable } from '@shared/ipc-tasks'
import { click, mount, type Mounted } from '../../../../../test/dom-render'
import { makeSession } from '../../../../../test/fixtures/events'

const h = vi.hoisted(() => ({ files: [] as TasksDeliverable[], cw: vi.fn() }))
vi.mock('./bridge', () => ({ cw: h.cw, onTasks: () => () => undefined, hasTasksBridge: () => true }))
vi.mock('../../../lib/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('../../../lib/useAppTheme', () => ({ useAppTheme: () => 'light' }))
vi.mock('./FileReview', () => ({ FileReview: () => null }))
vi.mock('../../../components/Markdown', () => ({ Markdown: () => null }))
vi.mock('../../../components/artifacts/ArtifactButton', () => ({ ArtifactButton: () => null }))
// La prueba cubre la ruta React/IPC; no simula un render nativo de Electron.
vi.mock('./useViewerViewport', () => ({
  useViewerViewport: () => ({ hostRef: null, shouldShowNative: true, hasViewport: true })
}))

import { useSessions } from '../../../stores/sessions'
import { autoOpenMainDeliverable, clearViewerRequest, useTasks } from './store'
import { DeliverableList } from './Deliverables'
import { ResultCard } from './ResultCard'
import { DocumentViewerPanel } from './DocumentViewerPanel'

function Workspace(): React.JSX.Element {
  const request = useTasks((s) => s.viewerRequest)
  return (
    <>
      <DeliverableList files={h.files} />
      {request && <DocumentViewerPanel key={request.nonce} path={request.path} visible onClose={clearViewerRequest} />}
    </>
  )
}

let mounted: Mounted | undefined
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
  h.cw.mockReset()
})

it.each([
  ['darwin', '/proyecto'],
  ['win32', 'C:\\Trabajo']
])('autoapertura y el botón Ver entregan la misma presentación al mismo IPC (%s)', async (platform, folder) => {
  Object.assign(window, { api: { platform } })
  const taskId = `viewer-${platform}`
  const path = `${folder}${platform === 'win32' ? '\\' : '/'}Informe #1 ñ.pptx`
  h.files = [{ path, relPath: 'Informe #1 ñ.pptx', size: 27_300, mtime: Date.now() }]
  h.cw.mockImplementation(async (channel: string) =>
    channel === 'tasks:deliverables' ? h.files : channel === 'tasks:viewer:open' ? { ok: true, mode: 'web' } : undefined
  )
  useSessions.setState({ sessions: { [taskId]: makeSession(taskId, folder) } })
  useTasks.setState({ folder, activeTaskId: taskId, viewerRequest: null, deliverables: {} })
  mounted = mount(<Workspace />)

  await act(() => autoOpenMainDeliverable(taskId))
  expect(useTasks.getState().viewerRequest).toMatchObject({ path, taskId, auto: true })
  const openCalls = (): unknown[][] => h.cw.mock.calls.filter(([channel]) => channel === 'tasks:viewer:open')
  expect(openCalls()).toHaveLength(1)
  const first = openCalls()[0]![1] as { openingId: string }
  expect(mounted.host.textContent).toContain('viewer.ready')

  click(mounted.q('button[aria-label="tasks.deliv.close"]'))
  expect(useTasks.getState().viewerRequest).toBeNull()
  click(mounted.qa('button').find((button) => button.textContent?.trim() === 'tasks.deliv.view')!)
  await act(async () => undefined)
  expect(openCalls()).toHaveLength(2)
  const second = openCalls()[1]![1] as { openingId: string }
  expect(second).toEqual({ ...first, openingId: expect.any(String) })
  expect(second.openingId).not.toBe(first.openingId)
  expect(first).toMatchObject({ path, lang: 'es', theme: 'light' })
  expect(useTasks.getState().viewerRequest).toMatchObject({ path, taskId })
  expect(useTasks.getState().viewerRequest?.auto).toBeUndefined()
  expect(mounted.host.textContent).toContain('viewer.ready')
})

it.each([
  ['darwin', '/proyecto/promo.mp4'],
  ['win32', String.raw`C:\Trabajo\promo.mp4`]
])('%s: MP4 abre desde su miniatura con duración', async (platform, path) => {
  Object.assign(window, { api: { platform } })
  h.files = [{ path, relPath: 'promo.mp4', size: 1200000, mtime: Date.now() }]
  h.cw.mockImplementation(async (channel: string) =>
    channel === 'tasks:previewFile'
      ? { video: { duration: 15, poster: 'data:image/jpeg;base64,/9j/2Q==' } }
      : channel === 'tasks:viewer:open'
        ? { ok: true, mode: 'classic' }
        : undefined
  )
  useTasks.setState({ viewerRequest: null })
  mounted = mount(<Workspace />)
  await act(async () => undefined)
  expect(mounted.host.textContent).toContain('0:15')
  click(mounted.q('button[aria-label="viewer.video.preview"]'))
  await act(async () => undefined)
  expect(h.cw).toHaveBeenCalledWith('tasks:viewer:open', expect.objectContaining({ path, lang: 'es' }))
  expect(mounted.q('img')!.getAttribute('src')).toContain('data:image/jpeg')
  click(mounted.qa('button').find((button) => button.textContent?.includes('promo.mp4'))!)
  await act(async () => undefined)
  expect(h.cw.mock.calls.filter(([channel]) => channel === 'tasks:viewer:open')).toHaveLength(2)
  expect(h.cw.mock.calls.some(([channel]) => channel === 'tasks:openPath')).toBe(false)
  h.files = h.files.map((f) => ({ ...f, mtime: f.mtime + 1 }))
  mounted.rerender(<Workspace />)
  await act(async () => undefined)
  expect(h.cw.mock.calls.filter(([channel]) => channel === 'tasks:previewFile')).toHaveLength(2)
})

it('la tarjeta final de Overdrive muestra miniatura, duración y KB decimales; el nombre abre el visor', async () => {
  Object.assign(window, { api: { platform: 'darwin' } })
  const path = '/proyecto/final.mp4'
  h.files = [{ path, relPath: 'final.mp4', size: 646200, mtime: 1 }]
  h.cw.mockImplementation(async (channel: string) =>
    channel === 'tasks:previewFile' ? { video: { duration: 15, poster: 'data:image/jpeg;base64,/9j/2Q==' } } : undefined
  )
  useTasks.setState({ activeTaskId: 'final', deliverables: { final: h.files }, viewerRequest: null })
  mounted = mount(<ResultCard taskId="final" />)
  await act(async () => undefined)
  expect(mounted.host.textContent).toContain('0:15')
  expect(mounted.host.textContent).toContain('646 KB')
  expect(mounted.q('img')!.getAttribute('src')).toContain('data:image/jpeg')
  click(mounted.qa('button').find((button) => button.textContent === 'final.mp4')!)
  expect(useTasks.getState().viewerRequest).toMatchObject({ path })
  expect(h.cw.mock.calls.some(([channel]) => channel === 'tasks:openPath')).toBe(false)
})
