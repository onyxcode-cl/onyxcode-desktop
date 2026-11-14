// @vitest-environment jsdom
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
vi.mock('./client', async (orig) => ({
  ...(await orig<typeof import('./client')>()),
  nativeCode: () => null,
  useClient: () => null
}))
vi.mock('./folder-access', async (orig) => ({
  ...(await orig<typeof import('./folder-access')>()),
  ensureFolderReadable: () => Promise.resolve(true)
}))
vi.mock('./panels/TerminalPanel', () => ({ TerminalPanel: () => null }))
vi.mock('@xterm/xterm', () => ({ Terminal: class {} }))
vi.mock('./Composer', () => ({ Composer: () => null }))
vi.mock('./CodeSummary', () => ({ CodeSummary: () => null }))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useLang } from '../../../lib/i18n'
import { CodeWorkspace } from './CodeWorkspace'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  useLang.setState({ lang: 'es' } as never)
  localStorage.clear()
  localStorage.setItem('code.panelWidth', '280')
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  useCode.setState({
    directory: '/work/toolbar',
    restoredFocus: null,
    projectPickerOpen: false,
    activeSessionID: null,
    openDirectories: ['/work/toolbar'],
    trustedFolders: ['/work/toolbar'],
    panel: null
  })
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const mount = async (): Promise<void> => {
  await act(async () => root.render(createElement(CodeWorkspace, { showSessionList: false })))
}

describe.each(['darwin', 'win32'])('barra de Código con panel lateral (%s)', (platform) => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', { value: { platform }, configurable: true })
  })
  it('oculta los accesos repetidos con el panel abierto y los recupera al cerrarlo', async () => {
    await mount()
    const group = host.querySelector('[role="group"]')!
    expect(group.parentElement!.className).toBe('contents')
    const summary = group.querySelector('button')!
    await act(async () => summary.click())
    expect(group.parentElement!.className).toBe('hidden')
    const close = host.querySelector('[role="complementary"] button[title]') as HTMLButtonElement
    expect(close).not.toBeNull()
    await act(async () => close.click())
    expect(group.parentElement!.className).toBe('contents')
  })

  it('reserva el margen de controles de Windows fuera del scroll y mantiene el cierre como hermano fijo', async () => {
    useCode.setState({ panel: 'summary' })
    await mount()
    const panel = host.querySelector('[role="complementary"]') as HTMLElement
    expect(panel.style.width).toBe('280px')
    const close = panel.querySelector('button[title]') as HTMLButtonElement
    const header = close.parentElement!
    const scroll = header.querySelector('.overflow-x-auto')!
    expect(header.classList.contains('flex')).toBe(true)
    expect(header.className).toContain('desk:pr-[calc(var(--controls-inset,0px)+12px)]')
    expect(header.className).not.toContain('overflow-x-auto')
    expect(scroll.classList.contains('min-w-0')).toBe(true)
    expect(scroll.classList.contains('flex-1')).toBe(true)
    expect(scroll.querySelectorAll('button')).toHaveLength(5)
    expect(scroll.contains(close)).toBe(false)
    expect(scroll.parentElement).toBe(header)
    expect(close.classList.contains('shrink-0')).toBe(true)
    expect(close.classList.contains('sticky')).toBe(false)
  })
})
