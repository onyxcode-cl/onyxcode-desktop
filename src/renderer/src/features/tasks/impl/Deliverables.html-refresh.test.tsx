// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import type { TasksDeliverable } from '@shared/ipc-tasks'
import { mount, type Mounted } from '../../../../../test/dom-render'
const h = vi.hoisted(() => ({ cw: vi.fn(), artifact: vi.fn() }))
vi.mock('./bridge', () => ({ cw: h.cw, onTasks: () => () => undefined, hasTasksBridge: () => true }))
vi.mock('../../../lib/i18n', () => ({ useT: () => (key: string) => key, dateLocale: () => 'es' }))
vi.mock('./FileReview', () => ({ FileReview: () => null }))
vi.mock('../../../components/Markdown', () => ({ Markdown: () => null }))
vi.mock('../../../components/artifacts/ArtifactButton', () => ({
  ArtifactButton: (props: unknown) => {
    h.artifact(props)
    return null
  },
  DownloadHtmlButton: () => null,
  DownloadSlidesPptxButton: () => null,
  PresentSlidesButton: () => null
}))
import { DeliverableList } from './Deliverables'
import { useTasks } from './store'
let mounted: Mounted | undefined
afterEach(() => {
  mounted?.unmount()
  vi.clearAllMocks()
})
it('la tarjeta recarga el HTML cuando el agente corrige el mismo archivo', async () => {
  Object.assign(window, { api: { platform: 'darwin' } })
  useTasks.setState({ folder: '/project' })
  const file: TasksDeliverable = { path: '/project/deck.html', relPath: 'deck.html', size: 100, mtime: 1 }
  const initial = '<section class="slide"><img src="img/placeholder.jpg"></section>'
  const corrected = '<section class="slide"><img src="img/free-corrected.jpg"></section>'
  h.cw
    .mockResolvedValueOnce({ kind: 'text', content: initial, truncated: false })
    .mockResolvedValueOnce({ kind: 'text', content: corrected, truncated: false })
  mounted = mount(<DeliverableList files={[file]} />)
  await act(async () => undefined)
  expect(h.artifact).toHaveBeenLastCalledWith(expect.objectContaining({ html: initial }))
  mounted.rerender(<DeliverableList files={[{ ...file, mtime: 2 }]} />)
  await act(async () => undefined)
  expect(h.cw).toHaveBeenCalledTimes(2)
  expect(h.artifact).toHaveBeenLastCalledWith(
    expect.objectContaining({ html: corrected, context: { kind: 'file', path: file.path, root: '/project' } })
  )
})
