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
vi.mock('../../project-profile/ProjectCard', () => ({ ProjectCard: () => null }))
vi.mock('../../project-profile/useLinkedFolders', () => ({ useLinkedFolders: () => [] }))
const engine = vi.hoisted(() => ({ jobs: [] as unknown[] }))
vi.mock('../../../lib/api', async (orig) => ({
  ...(await orig<typeof import('../../../lib/api')>()),
  call: vi.fn(async (ch: string) => (ch === 'jobs:list' ? { available: true, jobs: engine.jobs } : { ok: true }))
}))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { call } from '../../../lib/api'
import { useLang } from '../../../lib/i18n'
import { CodeWorkspace } from './CodeWorkspace'
import { useCode } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  engine.jobs = []
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
    panel: null,
    sessions: {},
    messages: {},
    runState: {},
    errors: {},
    permissions: {},
    questions: {},
    todos: {}
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

describe.each(['darwin', 'win32'])('trabajos en Resumen (%s)', (platform) => {
  beforeEach(() => {
    Object.defineProperty(window, 'api', { value: { platform }, configurable: true })
  })

  it('con el panel cerrado cuenta los vivos, abre su tarjeta y le lleva el foco', async () => {
    const now = Date.now()
    useCode.setState({
      activeSessionID: 'root',
      sessions: { root: { id: 'root', title: 'Prueba', directory: '/work/toolbar', time: { created: now, updated: now } } as never },
      sessionProject: { root: '/work/toolbar' }
    })
    engine.jobs = [
      { id: 'live', kind: 'shell', title: 'Servidor vivo', state: 'en_curso', code: null, startedAt: now, endedAt: null },
      { id: 'stopped', kind: 'shell', title: 'Servidor parado', state: 'terminado_por_ti', code: null, startedAt: now, endedAt: now }
    ]
    await mount()
    expect(host.querySelector('[data-testid="code-jobs-indicator"]')?.textContent).toBe('1')
    expect(host.querySelector('section[aria-label="En segundo plano"]')).toBeNull()
    const button = host.querySelector('button[aria-label^="Resumen ·"]') as HTMLButtonElement
    expect(button.getAttribute('aria-label')).toContain('Trabajos en segundo plano')
    const reads = vi.mocked(call).mock.calls.filter(([ch]) => ch === 'jobs:list').length
    await act(async () => button.click())
    expect(vi.mocked(call).mock.calls.filter(([ch]) => ch === 'jobs:list')).toHaveLength(reads)
    const card = host.querySelector('[data-testid="code-summary-jobs"]')!
    expect(card.textContent).toContain('Servidor vivo')
    expect(card.textContent).toContain('Servidor parado')
    expect(card.closest('[data-testid="code-summary"]')).not.toBeNull()
    expect(document.activeElement).toBe(card)
    expect(host.querySelectorAll('section[aria-label="En segundo plano"]')).toHaveLength(1)
  })

  it('incluye ayudantes vivos aunque la raíz esté inactiva', async () => {
    const now = Date.now()
    useCode.setState({
      activeSessionID: 'root',
      sessions: {
        root: { id: 'root', directory: '/work/toolbar', time: { created: now - 30_000, updated: now } } as never,
        child: { id: 'child', parentID: 'root', time: { created: now - 30_000, updated: now } } as never
      },
      sessionProject: { root: '/work/toolbar' },
      runState: { root: 'idle', child: 'busy' },
      messages: {
        root: [
          {
            info: { id: 'm' } as never,
            parts: [
              {
                type: 'tool',
                tool: 'task',
                state: { status: 'completed', input: { description: 'Ayudante vivo' }, metadata: { sessionId: 'child', background: true } }
              } as never
            ]
          }
        ]
      }
    })
    await mount()
    expect(host.querySelector('[data-testid="code-jobs-indicator"]')?.textContent).toBe('1')
    await act(async () => (host.querySelector('button[aria-label^="Resumen ·"]') as HTMLButtonElement).click())
    expect(host.querySelector('[data-testid="code-summary-jobs"]')?.textContent).toContain('Ayudante vivo')
  })

  it('los trabajos parados o por reanudar no encienden el indicador', async () => {
    const now = Date.now()
    useCode.setState({
      activeSessionID: 'root',
      sessions: { root: { id: 'root', title: 'Prueba', directory: '/work/toolbar', time: { created: now, updated: now } } as never },
      sessionProject: { root: '/work/toolbar' }
    })
    engine.jobs = [
      { id: 'stopped', kind: 'shell', title: 'Servidor parado', state: 'terminado_por_ti', code: null, startedAt: now, endedAt: now },
      { id: 'lost', kind: 'ayudante', title: 'Por reanudar', state: 'perdido', code: null, startedAt: now, endedAt: now }
    ]
    await mount()
    expect(host.querySelector('[data-testid="code-jobs-indicator"]')).toBeNull()
    const button = host.querySelector('button[aria-label="Resumen"]') as HTMLButtonElement
    await act(async () => button.click())
    expect(host.querySelector('[data-testid="code-summary-jobs"]')?.textContent).toContain('Por reanudar')
  })
})
