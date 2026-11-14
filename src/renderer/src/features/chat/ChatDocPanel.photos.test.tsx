// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ChatDocPanel } from './ChatDocPanel'
import { setChatDocAskHandler } from '../../lib/chatDocPreview'
import { t } from '@shared/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./useChatDocViewport', () => ({ useChatDocViewport: () => ({ hostRef: { current: null }, shouldShowNative: false }) }))
vi.mock('../../components/artifacts/ArtifactButton', () => ({ DownloadMenuButton: () => null, PresentSlidesButton: () => null }))
vi.mock('../../components/artifacts/DataDocButton', () => ({ DownloadDataDocButton: () => null }))
vi.mock('../settings/impl/CraftComponentCard', () => ({ requestCraftInstall: vi.fn() }))
vi.mock('./ChatFiles', () => ({ ChatFileButtons: () => null }))

let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setChatDocAskHandler(null)
})

it('muestra la foto que falta sin desplegar detalles y la incluye al pedir la corrección', () => {
  const ask = vi.fn()
  setChatDocAskHandler(ask)
  const detail = t('chat.doc.problem.photoMissingDetail', { reference: 'imagen:foto-perdida' })
  act(() => {
    root.render(
      createElement(ChatDocPanel, {
        creating: false,
        title: 'Fotos',
        doc: { kind: 'html', rawText: '<section class="slide"><img src="imagen:foto-perdida"></section>', isSlides: true },
        problem: { reason: 'photo-missing', detail },
        onRetry: vi.fn(),
        fullscreen: false,
        onToggleFullscreen: vi.fn(),
        onClose: vi.fn()
      })
    )
  })
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(detail)
  expect(host.textContent).not.toContain(t('chat.doc.problem.invalid'))
  expect(host.textContent).not.toContain(t('chat.doc.showDetail'))
  const button = [...host.querySelectorAll('button')].find((b) => b.textContent === t('chat.doc.askAgain'))!
  expect(button).toBeDefined()
  act(() => button.click())
  expect(ask).toHaveBeenCalledWith(t('chat.doc.retryPrompt', { reason: detail }))
})
