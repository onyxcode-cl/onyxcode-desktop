// @vitest-environment jsdom
/** Ajustes › disposición: el contenedor de la sección lleva data-settings-layout (grid, list o cards); el buscador no. */
import '../../../../../test/jsdom-first' // debe ir ANTES de react-dom (ver el comentario de ese archivo)
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

for (const [path, name] of [
  ['./GeneralSection', 'GeneralSection'],
  ['./ShortcutsSection', 'ShortcutsSection'],
  ['./AboutSection', 'AboutSection'],
  ['./AutoModeSection', 'AutoModeSection'],
  ['./BrowserSection', 'BrowserSection'],
  ['./ComputerSection', 'ComputerSection'],
  ['./DiagnosticsSection', 'DiagnosticsSection'],
  ['./TasksSection', 'TasksSection'],
  ['./InstructionsSection', 'InstructionsSection'],
  ['./MemorySection', 'MemorySection'],
  ['./McpSection', 'McpSection'],
  ['./ModelsSection', 'ModelsSection'],
  ['./NetworkSection', 'NetworkSection'],
  ['./RemoteSection', 'RemoteSection'],
  ['./UsageSection', 'UsageSection'],
  ['./ImportSection', 'ImportSection'],
  ['./TelegramSection', 'TelegramSection'],
  ['./HelpersSection', 'HelpersSection'],
  ['./EngineExperimentsSection', 'EngineExperimentsSection']
] as const) {
  vi.doMock(path, () => ({ [name]: () => createElement('div', null, name) }))
}
vi.mock('./extras', () => ({ initExtrasPrefs: () => () => undefined }))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

let host: HTMLDivElement
let root: Root

async function mount(section: string): Promise<void> {
  localStorage.setItem('settings.section', section)
  ;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
  const { SettingsView } = await import('./SettingsView')
  const { useUi } = await import('../../../stores/ui')
  useUi.setState({ openSettings: vi.fn() })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(SettingsView)))
}

const layoutOf = (): string | null => host.querySelector('[data-settings-layout]')?.getAttribute('data-settings-layout') ?? null

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('lazunox.langPref', 'es')
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { api?: unknown }).api
})

describe('disposición de las secciones de Ajustes', () => {
  it('General usa grid', async () => {
    await mount('general')
    expect(layoutOf()).toBe('grid')
  })
  it('Telegram usa list', async () => {
    await mount('telegram')
    expect(layoutOf()).toBe('list')
  })
  it('MCP usa cards (sin campo)', async () => {
    await mount('mcp')
    expect(layoutOf()).toBe('cards')
  })
  it('el panel de búsqueda no lleva el atributo', async () => {
    await mount('general')
    const input = host.querySelector('[data-testid="settings-search"]') as HTMLInputElement
    const key = Object.keys(input).find((k) => k.startsWith('__reactProps'))!
    const props = (input as unknown as Record<string, { onChange: (e: unknown) => void }>)[key]
    await act(async () => props.onChange({ target: { value: 'general' }, currentTarget: { value: 'general' } }))
    const panel = host.querySelector('[data-testid="settings-search-panel"]')
    expect(panel).not.toBeNull()
    expect(panel!.hasAttribute('data-settings-layout')).toBe(false)
    expect(host.querySelector('[data-settings-layout]')).toBeNull()
  })
})
