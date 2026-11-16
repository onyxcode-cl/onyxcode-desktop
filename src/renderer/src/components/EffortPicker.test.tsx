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
import { EffortPicker } from './EffortPicker'

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

function mount(modelID = 'a', variant: string | null = null): void {
  act(() => {
    root.render(
      createElement(
        'div',
        { 'data-effort-scope': '' },
        createElement('textarea'),
        createElement(ModelPicker, { value: { providerID: 'p', modelID }, onChange }),
        createElement(EffortPicker, { model: { providerID: 'p', modelID }, variant, onChange: onEffort })
      )
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
  vi.restoreAllMocks()
})

const trigger = (): HTMLButtonElement => document.body.querySelector('[data-testid="effort-picker"]') as HTMLButtonElement
const open = (): void => act(() => trigger().click())
const items = (): HTMLButtonElement[] => Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
const press = (key: string, init: KeyboardEventInit = {}): void => {
  act(() => {
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))
  })
}

describe('EffortPicker', () => {
  it('muestra siempre Estándar y el nombre accesible; traduce la selección', () => {
    mount()
    expect(trigger().textContent).toBe('Estándar')
    expect(trigger().getAttribute('aria-label')).toBe('Esfuerzo del modelo: Estándar')
    expect(trigger().querySelector('span')?.className).not.toContain('sr-only')
    expect(trigger().querySelector('svg:last-child')?.classList.contains('hidden')).toBe(false)
    mount('a', 'medium')
    expect(trigger().textContent).toBe('Medio')
    expect(trigger().getAttribute('aria-label')).toBe('Esfuerzo del modelo: Medio')
    act(() => useLang.setState({ lang: 'en' }))
    expect(trigger().textContent).toBe('Medium')
  })

  it('no aparece sin variantes ni en el celular', () => {
    mount('b')
    expect(trigger()).toBeNull()
    ;(window as unknown as { api: unknown }).api = { platform: 'remote' }
    mount()
    expect(trigger()).toBeNull()
  })

  it('lista Estándar primero, marca el elegido y envía el id original', () => {
    mount('a', 'high')
    open()
    expect(items().map((i) => i.dataset.option)).toEqual(['standard', 'low', 'medium', 'high'])
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true'])
    act(() => items()[2].click())
    expect(onEffort).toHaveBeenCalledWith('medium')
    expect(items()).toHaveLength(0)
    expect(document.activeElement).toBe(trigger())
    open()
    press('1')
    expect(onEffort).toHaveBeenLastCalledWith(null)
  })

  it.each(['darwin', 'win32'])('atajo desde el cuadro y el selector, flechas, Enter y Esc en %s', (platform) => {
    ;(window as unknown as { api: unknown }).api = { platform }
    mount('a', 'high')
    act(() => host.querySelector('textarea')!.focus())
    press('e', platform === 'darwin' ? { metaKey: true } : { ctrlKey: true })
    expect(document.activeElement).toBe(items()[3])
    press('ArrowUp')
    press('Enter')
    expect(onEffort).toHaveBeenCalledWith('medium')
    const modelTrigger = host.querySelector<HTMLButtonElement>('[data-model-picker]')!
    act(() => modelTrigger.click())
    act(() => document.body.querySelector('input')!.focus())
    press('e', platform === 'darwin' ? { metaKey: true } : { ctrlKey: true })
    expect(document.body.querySelector('[role="listbox"]')).toBeNull()
    expect(items()).toHaveLength(4)
    press('Escape')
    expect(items()).toHaveLength(0)
    expect(document.activeElement).toBe(trigger())
    act(() => modelTrigger.focus())
    press('e', platform === 'darwin' ? { metaKey: true } : { ctrlKey: true })
    expect(items()).toHaveLength(4)
  })

  it('el atajo no intercepta otros cuadros ni el modificador de otra plataforma', () => {
    mount()
    act(() => host.querySelector('textarea')!.focus())
    press('e', { ctrlKey: true })
    expect(items()).toHaveLength(0)
    const outside = document.createElement('textarea')
    document.body.appendChild(outside)
    act(() => outside.focus())
    press('e', { metaKey: true })
    expect(items()).toHaveLength(0)
    outside.remove()
  })

  it('traduce todos los niveles conocidos y capitaliza los desconocidos', () => {
    useProviders.setState({
      providers: [
        { id: 'p', models: { a: m('a', 'Modelo A', ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'none', 'custom']) } }
      ] as unknown as Provider[]
    })
    mount()
    open()
    expect(items().map((i) => i.querySelector('span')!.textContent)).toEqual([
      'Estándar',
      'Mínimo',
      'Bajo',
      'Medio',
      'Alto',
      'Muy alto',
      'Máximo',
      'Sin razonar',
      'Custom'
    ])
    act(() => useLang.setState({ lang: 'en' }))
    expect(items().map((i) => i.querySelector('span')!.textContent)).toEqual([
      'Standard',
      'Minimal',
      'Low',
      'Medium',
      'High',
      'Very high',
      'Max',
      'No reasoning',
      'Custom'
    ])
  })
  it.each([100, 700])('el portal cabe en la ventana y abre hacia el espacio disponible (ancla en %s)', (top) => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(800)
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(740, top, 55, 28))
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(160)
    mount()
    open()
    const panel = document.body.querySelector<HTMLElement>('[role="menu"]')!
    expect(panel.parentElement).toBe(document.body)
    expect(panel.className).toContain('no-drag')
    expect(parseFloat(panel.style.left) + parseFloat(panel.style.width)).toBeLessThanOrEqual(792)
    expect(panel.style[top === 100 ? 'top' : 'bottom']).not.toBe('')
    act(() => window.dispatchEvent(new Event('resize')))
    expect(items()).toHaveLength(0)
  })

  it('se actualiza al cambiar el modelo y cierra al pulsar fuera', () => {
    mount()
    open()
    act(() => document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(items()).toHaveLength(0)
    open()
    mount('b')
    expect(trigger()).toBeNull()
    expect(items()).toHaveLength(0)
  })
})
