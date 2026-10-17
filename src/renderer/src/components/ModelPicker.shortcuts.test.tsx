// @vitest-environment jsdom
import { vi } from 'vitest'

// Antes de importar React: sin los stubs globales de setup.ts el DOM es el de jsdom (React detecta bien el evento input).
vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { DEFAULT_SETTINGS } from '@shared/types'
import { useLang } from '../lib/i18n'
import { useProviders } from '../stores/providers'
import { useSettings } from '../stores/settings'
import { ModelPicker } from './ModelPicker'

Element.prototype.scrollIntoView = () => undefined
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// 14 modelos en dos proveedores: más de los que caben y más de nueve (los atajos llegan hasta el 9).
const model = (id: string, name: string) => ({ id, name, status: 'active', capabilities: { reasoning: id.endsWith('r') } })
const provider = (id: string, name: string, models: string[]): Provider =>
  ({
    id,
    name,
    models: Object.fromEntries(models.map((m) => [m, model(m, `Modelo ${m.toUpperCase()}`)]))
  }) as unknown as Provider
const PROVIDERS = [
  provider('opencode-go', 'Lazunox Go', ['a1', 'a2', 'a3', 'a4', 'a5r', 'a6', 'a7', 'a8']),
  provider('otro', 'Otro proveedor', ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'])
]

let host: HTMLDivElement
let root: Root
const onChange = vi.fn()

function mount(): void {
  act(() => {
    root.render(createElement(ModelPicker, { value: { providerID: 'opencode-go', modelID: 'a2' }, onChange }))
  })
}

beforeEach(() => {
  useLang.setState({ lang: 'es' })
  vi.unstubAllGlobals()
  delete (window as unknown as { api?: unknown }).api
  onChange.mockReset()
  useProviders.setState({ providers: PROVIDERS, loaded: true, loading: false, error: null, client: null })
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS, defaultModel: { providerID: 'opencode-go', modelID: 'a1' } } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  mount()
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const open = (): void => act(() => (host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement).click())
const rows = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="option"]'))
const press = (k: string, init: KeyboardEventInit): void => {
  const input = host.querySelector('input') as HTMLInputElement
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

describe('ModelPicker: atajos numéricos, predeterminado y altura', () => {
  it('los nueve primeros modelos llevan atajo ⌘1…⌘9 en Mac y el décimo no', () => {
    open()
    const kbd = rows().map((r) => r.querySelector('kbd')?.textContent ?? null)
    expect(kbd.slice(0, 9)).toEqual(['⌘1', '⌘2', '⌘3', '⌘4', '⌘5', '⌘6', '⌘7', '⌘8', '⌘9'])
    expect(kbd[9]).toBeNull()
    expect(rows()).toHaveLength(14)
  })

  it('en Windows el atajo es Ctrl+n y se activa con Ctrl, no con ⌘', () => {
    ;(window as unknown as { api: { platform: string } }).api = { platform: 'win32' }
    mount()
    open()
    expect(rows()[0]!.querySelector('kbd')?.textContent).toBe('Ctrl+1')
    press('3', { metaKey: true })
    expect(onChange).not.toHaveBeenCalled()
    press('3', { ctrlKey: true })
    expect(onChange).toHaveBeenCalledWith({ providerID: 'opencode-go', modelID: 'a3' })
  })

  it('⌘4 elige el cuarto modelo aunque el cuadro de búsqueda tenga el foco; un número solo se escribe en la búsqueda', () => {
    open()
    press('4', {})
    expect(onChange).not.toHaveBeenCalled()
    press('4', { metaKey: true })
    expect(onChange).toHaveBeenCalledWith({ providerID: 'opencode-go', modelID: 'a4' })
  })

  it('marca el predeterminado y el modelo actual, y escribe «Recomendado» con mayúscula', () => {
    open()
    const def = rows().filter((r) => r.textContent?.includes('Predeterminado'))
    expect(def).toHaveLength(1)
    expect(def[0]!.textContent).toContain('Modelo A1')
    expect(rows().filter((r) => r.getAttribute('aria-selected') === 'true')[0]!.textContent).toContain('Modelo A2')
    expect(host.textContent).toContain('Recomendado')
  })

  it('la lista tiene altura máxima ligada a la ventana y scroll propio; la búsqueda queda fuera del scroll', () => {
    open()
    const list = host.querySelector('[role="listbox"]') as HTMLElement
    expect(list.className).toContain('max-h-[min(20rem,calc(100vh-14rem))]')
    expect(list.className).toContain('overflow-y-auto')
    expect(list.contains(host.querySelector('input'))).toBe(false)
  })

  it('flechas y Enter siguen funcionando, y Esc cierra', () => {
    open()
    press('ArrowDown', {})
    press('Enter', {})
    expect(onChange).toHaveBeenCalledWith({ providerID: 'opencode-go', modelID: 'a3' })
    open()
    press('Escape', {})
    expect(host.querySelector('[role="listbox"]')).toBeNull()
  })
})
