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
