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

const trigger = (): HTMLButtonElement => document.body.querySelector('button[aria-haspopup="listbox"]') as HTMLButtonElement
const open = (): void => act(() => trigger().click())
const effortRow = (): HTMLButtonElement | null => document.body.querySelector('[data-effort-row]')
const subItems = (): HTMLButtonElement[] => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
const press = (k: string, init: KeyboardEventInit = {}): void => {
  const active = document.activeElement
  const target = (
    active && document.body.contains(active) && active !== document.body ? active : document.body.querySelector('input')
  ) as HTMLElement
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

describe('ModelPicker: esfuerzo solo en la hoja del celular', () => {
  it.each([null, 'high'])('en escritorio no hay fila, submenú ni etiqueta de esfuerzo (%s)', (variant) => {
    mount('a', variant)
    expect(document.body.querySelector('[data-testid="model-effort-badge"]')).toBeNull()
    expect(trigger().getAttribute('aria-label')).toBe('Modelo: Modelo A')
    open()
    expect(effortRow()).toBeNull()
    press('e', { metaKey: true })
    expect(subItems()).toHaveLength(0)
  })

  it('el celular conserva la fila, el valor original, la marca y el cambio de esfuerzo', () => {
    ;(window as unknown as { api: unknown }).api = { platform: 'remote' }
    mount('a', 'medium')
    expect(document.body.querySelector('[data-testid="model-effort-badge"]')?.textContent).toBe('Medium')
    open()
    expect(effortRow()!.textContent).toContain('Esfuerzo')
    expect(effortRow()!.textContent).toContain('Medium')
    act(() => effortRow()!.click())
    expect(subItems().map((i) => i.dataset.option)).toEqual(['standard', 'low', 'medium', 'high'])
    expect(subItems().map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false'])
    act(() => subItems()[3]!.click())
    expect(onEffort).toHaveBeenCalledWith('high')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('sin variantes o sin propiedad effort no ofrece esfuerzo tampoco en el celular', () => {
    ;(window as unknown as { api: unknown }).api = { platform: 'remote' }
    mount('b', 'high')
    open()
    expect(effortRow()).toBeNull()
    mount('a', null, false)
    expect(effortRow()).toBeNull()
  })
})
