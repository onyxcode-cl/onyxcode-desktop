// @vitest-environment jsdom
import { vi } from 'vitest'

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

const m = (id: string, name: string, variants?: string[]) => ({
  id,
  name,
  status: 'active',
  capabilities: { reasoning: !!variants },
  variants: variants ? Object.fromEntries(variants.map((v) => [v, {}])) : undefined
})
const PROVIDERS = [
  {
    id: 'p',
    name: 'Proveedor',
    models: { a: m('a', 'Modelo A', ['low', 'medium', 'high']), b: m('b', 'Modelo B') }
  }
] as unknown as Provider[]

let host: HTMLDivElement
let root: Root
const onChange = vi.fn()
const onEffort = vi.fn()

function mount(modelID = 'a', variant: string | null = null, withEffort = true): void {
  act(() => {
    root.render(
      createElement(ModelPicker, {
        value: { providerID: 'p', modelID },
        onChange,
        effort: withEffort ? { variant, onChange: onEffort } : undefined
      })
    )
  })
}
beforeEach(() => {
  useLang.setState({ lang: 'es' })
  onChange.mockReset()
  onEffort.mockReset()
  useProviders.setState({ providers: PROVIDERS, loaded: true, loading: false, error: null, client: null })
  useSettings.setState({ settings: { ...DEFAULT_SETTINGS } })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  act(() => root.unmount())
  host.remove()
})

const trigger = (): HTMLButtonElement => host.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement
const open = (): void => act(() => trigger().click())
const effortRow = (): HTMLButtonElement | null => host.querySelector('[data-effort-row]')
const subItems = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
const press = (k: string, init: KeyboardEventInit = {}): void => {
  const active = document.activeElement
  const target = (active && host.contains(active) && active !== document.body ? active : host.querySelector('input')) as HTMLElement
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

describe('ModelPicker: esfuerzo como submenú', () => {
  it('con esfuerzo estándar el chip no muestra el valor, pero el menú ofrece «Esfuerzo» con su valor actual', () => {
    mount('a', null)
    expect(host.querySelector('[data-testid="model-effort-badge"]')).toBeNull()
    expect(trigger().getAttribute('aria-label')).toBe('Modelo: Modelo A')
    open()
    expect(effortRow()!.textContent).toContain('Esfuerzo')
    expect(effortRow()!.textContent).toContain('Estándar')
    expect(effortRow()!.getAttribute('aria-haspopup')).toBe('menu')
  })

  it('con un esfuerzo distinto del predeterminado el chip lo muestra y lo dice en su nombre accesible', () => {
    mount('a', 'high')
    const badge = host.querySelector('[data-testid="model-effort-badge"]')!
    expect(badge.textContent).toBe('High')
    expect(badge.querySelector('span')!.className).toContain('desk:@max-[41rem]:sr-only')
    expect(trigger().getAttribute('aria-label')).toBe('Modelo: Modelo A, Esfuerzo del modelo: High')
  })

  it('un modelo sin variantes, o sin la propiedad effort, no ofrece el submenú', () => {
    mount('b', 'high')
    open()
    expect(effortRow()).toBeNull()
    expect(host.querySelector('[data-testid="model-effort-badge"]')).toBeNull()
    act(() => trigger().click())
    mount('a', null, false)
    open()
    expect(effortRow()).toBeNull()
  })

  it('abrir el submenú lista Estándar y las variantes del proveedor, marca la actual y elegir una cambia el esfuerzo y cierra', () => {
    mount('a', 'medium')
    open()
    act(() => effortRow()!.click())
    expect(subItems().map((i) => i.dataset.option)).toEqual(['standard', 'low', 'medium', 'high'])
    expect(subItems().map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false'])
    act(() => subItems()[3]!.click())
    expect(onEffort).toHaveBeenCalledWith('high')
    expect(host.querySelector('[role="listbox"]')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('teclado: Ctrl+E abre el submenú, los números eligen, ↑↓ + Enter eligen, Esc vuelve a la lista y el estándar manda null', () => {
    ;(window as unknown as { api: unknown }).api = { platform: 'win32' }
    mount('a', 'high')
    open()
    press('e', { ctrlKey: true })
    expect(subItems().length).toBe(4)
    expect(document.activeElement).toBe(subItems()[3])
    press('Escape')
    expect(host.querySelector('[role="listbox"]')).not.toBeNull()
    expect(subItems().length).toBe(0)
    press('e', { ctrlKey: true })
    press('ArrowUp')
    press('ArrowUp')
    press('Enter')
    expect(onEffort).toHaveBeenLastCalledWith('low')
    open()
    press('e', { ctrlKey: true })
    press('1')
    expect(onEffort).toHaveBeenLastCalledWith(null)
  })

  it('en Mac el atajo es ⌘E (y se muestra en la fila); en Windows, Ctrl+E', () => {
    mount('a', null)
    open()
    expect(effortRow()!.textContent).toContain('⌘E')
    press('e', { ctrlKey: true })
    expect(subItems().length).toBe(0)
    press('e', { metaKey: true })
    expect(subItems().length).toBe(4)
    act(() => root.unmount())
    root = createRoot(host)
    ;(window as unknown as { api: unknown }).api = { platform: 'win32' }
    mount('a', null)
    open()
    expect(effortRow()!.textContent).toContain('Ctrl+E')
  })

  it('teclado en la lista: ↓ hasta la fila «Esfuerzo» y Enter abre el submenú; elegir un modelo no cambia el esfuerzo', () => {
    mount('a', null)
    open()
    press('ArrowDown')
    press('ArrowDown')
    expect(effortRow()!.className).toContain('bg-hover')
    press('Enter')
    expect(subItems().length).toBe(4)
    expect(onChange).not.toHaveBeenCalled()
  })
})
