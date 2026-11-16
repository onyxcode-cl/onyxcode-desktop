// @vitest-environment jsdom
import { vi } from 'vitest'
vi.hoisted(() => vi.unstubAllGlobals())
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { useProviders } from '../stores/providers'
import { ModelPicker } from './ModelPicker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = () => undefined

let host: HTMLDivElement
let root: Root
let anchor: DOMRect
const onChange = vi.fn()
const trigger = (): HTMLButtonElement => host.querySelector('button')!
const panel = (): HTMLDivElement | null => document.body.querySelector('div.fixed')
const rect = (top: number, left = 200): DOMRect => new DOMRect(left, top, 180, 28)

function open(placement: 'top' | 'bottom' = 'top'): void {
  act(() =>
    root.render(
      createElement(ModelPicker, {
        value: { providerID: 'p', modelID: 'm0' },
        onChange,
        placement,
        effort: { variant: null, onChange: vi.fn() }
      })
    )
  )
  act(() => trigger().click())
}

beforeEach(() => {
  onChange.mockReset()
  anchor = rect(347)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(820)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this === trigger() ? anchor : new DOMRect()
  })
  // jsdom no hace layout: reproducimos la lista larga y las filas medidas en Windows.
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.getAttribute('role') === 'listbox' ? 1584 : 180
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.querySelector('input') ? 40 : 41
  })
  useProviders.setState({
    providers: [
      {
        id: 'p',
        name: 'Proveedor',
        models: Object.fromEntries(
          Array.from({ length: 47 }, (_, i) => [
            `m${i}`,
            {
              id: `m${i}`,
              name: `Modelo ${String(i).padStart(2, '0')}`,
              capabilities: { reasoning: true },
              variants: { low: {}, high: {} }
            }
          ])
        )
      }
    ] as unknown as Provider[],
    loaded: true,
    loading: false,
    error: null,
    client: null
  })
  host = document.createElement('div')
  host.style.overflow = 'hidden'
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  delete (window as unknown as { api?: unknown }).api
})

describe('ModelPicker: portal dentro de la ventana', () => {
  it('el celular conserva la hoja y su lista sin el límite ni el cierre por resize del popover', () => {
    Object.assign(window, { api: { platform: 'remote' } })
    open()
    const list = document.body.querySelector('[role="listbox"]')!
    expect(list.closest('[aria-modal="true"]')).not.toBeNull()
    expect(list.className).toBe('p-1')
    expect(document.body.querySelector('.no-drag.fixed')).toBeNull()
    act(() => window.dispatchEvent(new Event('resize')))
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('Overdrive: abre abajo, fuera del contenedor que recorta y con el buscador enfocado', () => {
    open()
    expect(panel()!.parentElement).toBe(document.body)
    expect(panel()!.style.top).toBe('383px')
    expect(panel()!.style.bottom).toBe('')
    expect(panel()!.style.maxHeight).toBe('429px')
    expect(document.activeElement).toBe(panel()!.querySelector('input'))
    expect(panel()!.classList.contains('no-drag')).toBe(true)
    expect(panel()!.className).toContain('[&_*]:[-webkit-app-region:no-drag]')
  })

  it('Code: el botón inferior conserva la apertura hacia arriba', () => {
    anchor = rect(740)
    open()
    expect(panel()!.style.bottom).toBe('88px')
    expect(panel()!.style.maxHeight).toBe('676px')
  })

  it('respeta bottom si cabe y lo invierte cerca del borde inferior', () => {
    anchor = rect(100)
    open('bottom')
    expect(panel()!.style.top).toBe('136px')
    act(() => trigger().click())
    anchor = rect(740)
    open('bottom')
    expect(panel()!.style.bottom).toBe('88px')
  })

  it('600px: limita el panel al espacio real por encima de la franja de arrastre', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600)
    open()
    const p = panel()!
    expect(p.style.bottom).toBe('261px')
    expect(p.style.maxHeight).toBe('283px')
    expect(600 - parseFloat(p.style.bottom) - parseFloat(p.style.maxHeight)).toBe(56)
    const list = p.querySelector('[role="listbox"]')!
    expect(list.className).toContain('min-h-0')
    expect(list.className).toContain('overflow-y-auto')
    expect(list.contains(p.querySelector('input'))).toBe(false)
  })

  it('cerca del borde superior abre hacia abajo y en ventana estrecha limita también el ancho', () => {
    anchor = rect(60, 270)
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(300)
    open()
    expect(panel()!.style.top).toBe('96px')
    expect(panel()!.style.left).toBe('8px')
    expect(panel()!.style.width).toBe('284px')
  })

  it('el clic y el scroll dentro del portal no cierran; elegir un modelo sí', () => {
    open()
    act(() =>
      panel()!
        .querySelector('input')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    )
    act(() => panel()!.querySelector('[role="listbox"]')!.dispatchEvent(new Event('scroll')))
    expect(panel()).not.toBeNull()
    act(() => (panel()!.querySelectorAll('[role="option"]')[1] as HTMLButtonElement).click())
    expect(onChange).toHaveBeenCalledWith({ providerID: 'p', modelID: 'm1' })
    expect(panel()).toBeNull()
  })

  it.each(['resize', 'scroll', 'mousedown'])('cierra con %s fuera del panel', (event) => {
    open()
    act(() => {
      if (event === 'resize') window.dispatchEvent(new Event(event))
      else document.body.dispatchEvent(new Event(event, { bubbles: true }))
    })
    expect(panel()).toBeNull()
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })
})
