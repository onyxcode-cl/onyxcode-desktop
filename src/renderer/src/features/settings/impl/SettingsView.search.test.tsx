// @vitest-environment jsdom
/**
 * Ajustes › búsqueda: filtra por título de sección y por texto de las opciones (claves i18n reales), resalta, agrupa, abre la sección
 * y lleva a la opción; ⌘F/Ctrl+F enfoca el campo; sin resultados explica qué hacer; el teclado alcanza todo.
 */
import '../../../../../test/jsdom-first' // debe ir ANTES de react-dom (ver el comentario de ese archivo)
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { t } from '@shared/i18n'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// Las secciones reales cargan datos y puentes; aquí solo importa que pinten el texto de sus opciones.
const fakeSection = (keys: string[]) =>
  function Fake(): React.JSX.Element {
    return createElement(
      'div',
      null,
      keys.map((k) =>
        createElement(
          'div',
          { key: k, 'data-row': '' },
          createElement('span', null, t(k as never)),
          createElement('button', { type: 'button', 'data-opt': k }, 'ok')
        )
      )
    )
  }
vi.mock('./GeneralSection', () => ({ GeneralSection: fakeSection(['settings.general.accent', 'settings.general.textSize']) }))
vi.mock('./ShortcutsSection', () => ({ ShortcutsSection: fakeSection(['settings.shortcuts.title']) }))
for (const [path, name] of [
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
  ['./ImportSection', 'ImportSection']
] as const) {
  vi.doMock(path, () => ({ [name]: () => createElement('div', null, name) }))
}
vi.mock('./extras', () => ({ initExtrasPrefs: () => () => undefined }))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

let host: HTMLDivElement
let root: Root
const close = vi.fn()

async function mount(): Promise<void> {
  ;(window as unknown as { api: unknown }).api = { platform: 'darwin' }
  const { SettingsView } = await import('./SettingsView')
  const { useUi } = await import('../../../stores/ui')
  useUi.setState({ openSettings: close })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => root.render(createElement(SettingsView)))
}

const input = (): HTMLInputElement => host.querySelector('[data-testid="settings-search"]') as HTMLInputElement
async function type(value: string): Promise<void> {
  const el = input()
  const key = Object.keys(el).find((k) => k.startsWith('__reactProps'))!
  const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key]
  await act(async () => props.onChange({ target: { value }, currentTarget: { value } }))
}
async function press(key: string): Promise<void> {
  const el = input()
  const k = Object.keys(el).find((x) => x.startsWith('__reactProps'))!
  const props = (el as unknown as Record<string, { onKeyDown: (e: unknown) => void }>)[k]
  await act(async () => props.onKeyDown({ key, preventDefault: () => undefined, stopPropagation: () => undefined }))
}

beforeEach(async () => {
  vi.unstubAllGlobals()
  vi.resetModules()
  close.mockClear()
  localStorage.clear()
  localStorage.setItem('lazunox.langPref', 'es')
  await mount()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { api?: unknown }).api
})

describe('búsqueda en Ajustes', () => {
  it('hay un campo «Buscar en Ajustes» sobre el menú y la sección Importar está en él', () => {
    expect(input()).not.toBeNull()
    expect(input().getAttribute('aria-label')).toBe('Buscar en Ajustes')
    const nav = host.querySelector('nav')!
    expect(nav.firstElementChild!.contains(input())).toBe(true)
    expect(nav.textContent).toContain('Importar')
  })

  it('filtra por texto de una opción, agrupa por sección y resalta la coincidencia', async () => {
    await type('tamano')
    const groups = host.querySelectorAll('[data-testid="settings-search-panel"] section')
    expect(groups.length).toBeGreaterThan(0)
    const opt = host.querySelector('[role="option"]') as HTMLElement
    expect(opt.textContent).toContain('Tamaño del texto')
    expect(opt.querySelector('mark.settings-mark')?.textContent).toBe('Tamaño')
    expect(host.querySelector('[data-testid="settings-search-panel"] h3')?.textContent).toContain('General')
  })

  it('coincide por título de sección (sin tildes) y lo marca como «Sección»', async () => {
    await type('importar')
    const first = host.querySelector('[role="option"]') as HTMLElement
    expect(first.textContent).toContain('Importar')
    expect(first.textContent).toContain('Sección')
  })

  it('elegir un resultado abre la sección, limpia la búsqueda y lleva a la opción (foco y resalte)', async () => {
    await type('color de acento')
    vi.useFakeTimers()
    const opt = [...host.querySelectorAll('[role="option"]')].find((o) => o.textContent?.includes('Color de acento')) as HTMLElement
    const key = Object.keys(opt).find((k) => k.startsWith('__reactProps'))!
    await act(async () => (opt as unknown as Record<string, { onClick: () => void }>)[key].onClick())
    expect(input().value).toBe('')
    await act(async () => {
      vi.advanceTimersByTime(300)
    })
    vi.useRealTimers()
    const row = [...host.querySelectorAll('[data-row]')].find((r) => r.textContent?.includes('Color de acento')) as HTMLElement
    expect(row).toBeTruthy()
    expect(row.hasAttribute('data-search-hit')).toBe(true)
    expect(document.activeElement).toBe(row.querySelector('button'))
    expect(localStorage.getItem('settings.section')).toBe('general')
  })

  it('teclado: flechas mueven la selección, Enter elige, Esc borra y luego cierra Ajustes', async () => {
    await type('a')
    const total = host.querySelectorAll('[role="option"]').length
    expect(total).toBeGreaterThan(1)
    expect(host.querySelector('[role="option"][aria-selected="true"]')!.id).toBe('settings-hit-0')
    await press('ArrowDown')
    expect(host.querySelector('[role="option"][aria-selected="true"]')!.id).toBe('settings-hit-1')
    await press('ArrowUp')
    await press('ArrowUp')
    expect(host.querySelector('[role="option"][aria-selected="true"]')!.id).toBe(`settings-hit-${total - 1}`)
    await press('Enter')
    expect(input().value).toBe('')
    expect(host.querySelector('[data-testid="settings-search-panel"]')).toBeNull()
    await type('zzz')
    await press('Escape')
    expect(input().value).toBe('')
    expect(close).not.toHaveBeenCalled()
    await press('Escape')
    expect(close).toHaveBeenCalledWith(false)
  })

  it('sin resultados: mensaje con la consulta y una sugerencia útil, anunciado a lectores de pantalla', async () => {
    await type('qwertyuiop')
    const empty = host.querySelector('[data-testid="settings-search-empty"]')!
    expect(empty.textContent).toContain('Nada coincide con «qwertyuiop»')
    expect(empty.textContent).toContain('Prueba con otra palabra')
    expect(host.querySelector('[role="status"]')!.textContent).toContain('Nada coincide')
  })

  it('⌘F y Ctrl+F enfocan el buscador dentro de Ajustes', async () => {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      ;(document.activeElement as HTMLElement | null)?.blur()
      const ev = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, ...mod })
      await act(async () => {
        window.dispatchEvent(ev)
      })
      expect(ev.defaultPrevented).toBe(true)
      expect(document.activeElement).toBe(input())
    }
  })

  it('el botón de borrar limpia la consulta y los grupos del menú siguen accesibles', async () => {
    await type('tema')
    const clear = host.querySelector(`button[aria-label="${t('settings.search.clear')}"]`) as HTMLButtonElement
    await act(async () => clear.click())
    expect(input().value).toBe('')
    expect(host.querySelectorAll('nav [role="group"]').length).toBeGreaterThan(2)
  })
})
