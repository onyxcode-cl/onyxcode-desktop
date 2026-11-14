// @vitest-environment jsdom
import { act } from 'react'
import { afterEach, expect, it, vi } from 'vitest'
import { click, mount, type Mounted } from '../../../../../test/dom-render'
const h = vi.hoisted(() => ({ cw: vi.fn(), invoke: vi.fn(), folder: '/project', panel: null as Record<string, unknown> | null }))
vi.mock('./bridge', () => ({ cw: h.cw }))
vi.mock('./store', () => ({ useTasks: (select: (s: { folder: string }) => unknown) => select({ folder: h.folder }) }))
vi.mock('../../../lib/extrasApi', () => ({ getExtras: () => ({ invoke: h.invoke, on: () => () => undefined }) }))
vi.mock('../../../lib/useAppTheme', () => ({ useAppTheme: () => 'light' }))
vi.mock('../../../lib/i18n', () => ({ useT: () => (key: string) => key }))
vi.mock('../../chat/ChatDocPanel', () => ({
  ChatDocPanel: (props: Record<string, unknown>) => {
    h.panel = props
    return <button onClick={props.onRetry as () => void}>retry</button>
  }
}))
import { HtmlPreviewDialog } from './HtmlPreviewDialog'
let mounted: Mounted | undefined
const html = '<section class="slide"><img src="img/free-photo.jpg"></section>'
afterEach(() => {
  mounted?.unmount()
  mounted = undefined
  vi.clearAllMocks()
})
it('Ver abre HTML renderizado con el contexto y las acciones del panel de Chat', async () => {
  h.cw.mockResolvedValue({ kind: 'text', content: html, size: html.length, truncated: false })
  h.invoke.mockResolvedValue({ ok: true, bytes: 123 })
  mounted = mount(
    <HtmlPreviewDialog file={{ path: '/project/cafe.html', relPath: 'cafe.html', size: 100, mtime: 0 }} onClose={() => undefined} />
  )
  await act(async () => undefined)
  expect(h.invoke).toHaveBeenCalledWith(
    'extras:chatDoc:open',
    expect.objectContaining({ kind: 'pdf', html, context: { kind: 'file', path: '/project/cafe.html', root: '/project' } })
  )
  expect(h.panel).toMatchObject({
    creating: false,
    problem: null,
    doc: { kind: 'html', rawText: html, isSlides: true, context: { kind: 'file', path: '/project/cafe.html', root: '/project' } }
  })
  mounted.unmount()
  mounted = undefined
  expect(h.invoke).toHaveBeenCalledWith('extras:chatDoc:close', { sessionId: expect.stringMatching(/^tasks-html-/) })
})
it('muestra el error de resolución y conserva el contexto al reintentar', async () => {
  h.cw.mockResolvedValue({ kind: 'text', content: html, size: html.length, truncated: false })
  h.invoke.mockResolvedValue({ ok: false, reason: 'invalid', detail: 'Foto fuera de ámbito' })
  mounted = mount(
    <HtmlPreviewDialog file={{ path: '/project/cafe.html', relPath: 'cafe.html', size: 100, mtime: 0 }} onClose={() => undefined} />
  )
  await act(async () => undefined)
  expect(h.panel).toMatchObject({ creating: false, problem: { reason: 'invalid', detail: 'Foto fuera de ámbito' } })
  click(mounted.q('button'))
  await act(async () => undefined)
  const opens = h.invoke.mock.calls.filter(([channel]) => channel === 'extras:chatDoc:open')
  expect(opens).toHaveLength(2)
  expect(opens[0][1].sessionId).not.toBe(opens[1][1].sessionId)
})
