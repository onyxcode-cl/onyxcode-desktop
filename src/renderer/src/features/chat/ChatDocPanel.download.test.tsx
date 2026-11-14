// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatDocPanel } from './ChatDocPanel'

const api = vi.hoisted(() => ({ invoke: vi.fn(), downloadHtmlAsPdf: vi.fn(), downloadSlidesAsPptx: vi.fn(), downloadHtml: vi.fn() }))
vi.mock('../../lib/extrasApi', () => ({ getExtras: () => api }))
vi.mock('./useChatDocViewport', () => ({ useChatDocViewport: () => ({ hostRef: { current: null }, shouldShowNative: false }) }))
vi.mock('../settings/impl/CraftComponentCard', () => ({ requestCraftInstall: vi.fn() }))
vi.mock('./ChatFiles', () => ({ ChatFileButtons: () => null }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})
function panel(kind: 'html' | 'pptx', rawText: string): void {
  act(() =>
    root.render(
      <ChatDocPanel
        creating={false}
        title="Historia"
        doc={{ kind, rawText, isSlides: true }}
        problem={null}
        onRetry={vi.fn()}
        fullscreen={false}
        onToggleFullscreen={vi.fn()}
        onClose={vi.fn()}
      />
    )
  )
}
it('PowerPoint editable de 60 láminas ofrece solo su descarga PPTX y llama al exportador PPTX', async () => {
  const data = { title: 'Historia', slides: Array.from({ length: 60 }, (_, i) => ({ title: `Lámina ${i + 1}` })) }
  panel('pptx', JSON.stringify(data))
  expect(host.innerHTML).not.toContain('Descargar como PDF')
  expect(host.querySelector('[aria-haspopup="menu"]')).toBeNull()
  const button = host.querySelector<HTMLButtonElement>('[aria-label="Descargar como PPTX"]')!
  expect(button).not.toBeNull()
  await act(async () => button.click())
  expect(api.invoke).toHaveBeenCalledWith('extras:downloadChatDoc', { kind: 'pptx', title: 'Historia', data: { slides: data.slides } })
  expect(api.downloadHtmlAsPdf).not.toHaveBeenCalled()
})
it('presentación HTML conserva PDF, PowerPoint imagen y HTML; PDF usa su convertidor', async () => {
  const html = '<html><body><section class="slide">Historia</section></body></html>'
  panel('html', html)
  act(() => host.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click())
  const items = [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
  expect(items.map((item) => item.textContent)).toEqual(['PDF', 'PowerPoint (imagen 4K)', 'HTML'])
  await act(async () => items[0].click())
  expect(api.downloadHtmlAsPdf).toHaveBeenCalledWith(expect.objectContaining({ html, title: 'Historia' }))
  expect(api.invoke).not.toHaveBeenCalled()
})
