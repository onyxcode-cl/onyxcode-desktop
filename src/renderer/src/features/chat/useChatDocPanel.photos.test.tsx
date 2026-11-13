// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatDocPanel, type ChatDocPanelState } from './useChatDocPanel'
import { requestViewChatFile } from '../../lib/chatFileView'
import { previewInChatDocPanel, currentArtifactContext } from '../../lib/chatDocPreview'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('../../lib/platform', async (orig) => ({
  ...(await orig<typeof import('../../lib/platform')>()),
  platformCaps: () => ({ docViewer: true })
}))
let root: Root, host: HTMLDivElement, invoke: ReturnType<typeof vi.fn>, panel: ChatDocPanelState
const html = '<section class="slide"><img src="imagen:prepared"></section>'
function Probe(): null {
  panel = useChatDocPanel('ses_current', [])
  return null
}
const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
beforeEach(() => {
  vi.unstubAllGlobals()
  invoke = vi.fn(async (channel: string) =>
    channel === 'extras:chatFile:read' ? { ok: true, kind: 'html', text: html, truncated: false } : { ok: true }
  )
  ;(window as unknown as { api: unknown }).api = { extras: { invoke, on: () => () => undefined } }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root.render(createElement(Probe)))
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { api?: unknown }).api
})
describe('HTML: vista, reintento y exportación conservan contexto', () => {
  it('detecta .slide de archivo de Código y conserva contexto de archivo en el panel', async () => {
    act(() =>
      requestViewChatFile(
        { path: '/project/deck.html', name: 'deck.html', bytes: 100, kind: 'html', canView: true, canOpen: true },
        { kind: 'file', path: '/project/deck.html', root: '/project' }
      )
    )
    await flush()
    expect(panel.doc).toMatchObject({ isSlides: true, context: { kind: 'file', path: '/project/deck.html', root: '/project' } })
    expect(invoke).toHaveBeenCalledWith(
      'extras:chatDoc:open',
      expect.objectContaining({ html, context: { kind: 'file', path: '/project/deck.html', root: '/project' } })
    )
    act(() => panel.retry())
    await flush()
    expect(invoke.mock.calls.filter((c) => c[0] === 'extras:chatDoc:open').every((c) => c[1].context.kind === 'file')).toBe(true)
  })
  it('lleva la conversación actual a los bloques HTML y al proveedor de botones', async () => {
    act(() => {
      previewInChatDocPanel('html', html, 'Fotos', true)
    })
    await flush()
    expect(panel.doc?.context).toEqual({ kind: 'chat', sessionId: 'ses_current' })
    expect(currentArtifactContext()).toEqual({ kind: 'chat', sessionId: 'ses_current' })
  })
  it('un fallo de archivo no convierte el reintento en contexto Chat', async () => {
    invoke.mockImplementation(async (channel: string) =>
      channel === 'extras:chatFile:read'
        ? { ok: true, kind: 'html', text: html, truncated: false }
        : { ok: false, reason: 'invalid', detail: 'Foto fuera de ámbito' }
    )
    act(() =>
      requestViewChatFile({ path: '/project/deck.html', name: 'deck.html', bytes: 100, kind: 'html', canView: true, canOpen: true })
    )
    await flush()
    expect(panel.problem?.detail).toBe('Foto fuera de ámbito')
    act(() => panel.retry())
    await flush()
    expect(panel.doc?.context).toEqual({ kind: 'file', path: '/project/deck.html' })
  })
})
