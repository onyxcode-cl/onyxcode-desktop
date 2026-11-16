// @vitest-environment jsdom
import { vi } from 'vitest'
vi.hoisted(() => vi.unstubAllGlobals())
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@opencode-ai/sdk/v2/client'
import { useProviders } from '../../stores/providers'
import { CompareControls } from './CompareControls'
import { ctxKey, useCompare } from './store'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = () => undefined

let host: HTMLDivElement
let root: Root
let anchor: DOMRect
const trigger = (): HTMLButtonElement => host.querySelector('button')!
const panel = (): HTMLDivElement | null => document.body.querySelector('[data-testid="compare-launcher"]')
const open = (): void => act(() => trigger().click())
const press = (key: string): void =>
  act(() => {
    panel()!
      .querySelector('input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  })

beforeEach(() => {
  Object.assign(window, { api: { platform: 'win32', code: { compare: { list: vi.fn(), start: vi.fn() } } } })
  useCompare.setState({ armed: {}, manifests: {} })
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
              capabilities: { reasoning: false }
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
  anchor = new DOMRect(1000, 347, 100, 28)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1280)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(820)
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    cb(0)
    return 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this === trigger() ? anchor : new DOMRect()
  })
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1700)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(40)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root.render(<CompareControls mode="chat" directory={null} current={{ providerID: 'p', modelID: 'm0' }} align="right" />))
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (window as unknown as { api?: unknown }).api
  vi.restoreAllMocks()
})

describe('Comparar: selector dentro de la ventana', () => {
  it('sale hacia abajo en un portal no arrastrable alineado a la derecha, con foco en la búsqueda', () => {
    open()
    expect(panel()!.parentElement).toBe(document.body)
    expect(panel()!.style.top).toBe('383px')
    expect(panel()!.style.left).toBe('760px')
    expect(panel()!.classList.contains('no-drag')).toBe(true)
    expect(panel()!.className).toContain('[&_*]:[-webkit-app-region:no-drag]')
    expect(document.activeElement).toBe(panel()!.querySelector('input'))
  })

  it('en 600px encoge la lista y un botón inferior abre arriba; resize cierra', () => {
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(600)
    open()
    expect(panel()!.style.bottom).toBe('261px')
    expect(panel()!.style.maxHeight).toBe('283px')
    expect(panel()!.querySelector('[role="listbox"]')!.className).toContain('min-h-0')
    act(() => window.dispatchEvent(new Event('resize')))
    expect(panel()).toBeNull()
    anchor = new DOMRect(1000, 520, 100, 28)
    open()
    expect(panel()!.style.bottom).toBe('88px')
  })

  it('reabre vacío con el cursor en el modelo actual, aunque no sea el primero', () => {
    act(() => root.render(<CompareControls mode="chat" directory={null} current={{ providerID: 'p', modelID: 'm25' }} />))
    open()
    const input = panel()!.querySelector('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'sin-coincidencias')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(panel()!.querySelectorAll('[role="option"]')).toHaveLength(0)
    press('Escape')
    open()
    expect(panel()!.querySelector('input')!.value).toBe('')
    expect(panel()!.querySelectorAll('[role="option"]')).toHaveLength(47)
    const id = panel()!.querySelector('[role="listbox"]')!.getAttribute('aria-activedescendant')!
    expect(document.getElementById(id)?.textContent).toContain('Modelo 25')
    press('Enter')
    expect(panel()!.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(0)
  })

  it('mantiene flechas, Enter, selección múltiple y Esc; el scroll y clic internos no cierran', () => {
    open()
    act(() =>
      panel()!
        .querySelector('input')!
        .dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    )
    act(() => panel()!.querySelector('[role="listbox"]')!.dispatchEvent(new Event('scroll')))
    press('ArrowDown')
    press('Enter')
    expect(panel()!.querySelectorAll('[role="option"][aria-selected="true"]')).toHaveLength(2)
    act(() => panel()!.querySelector<HTMLButtonElement>('button')!.click())
    expect(useCompare.getState().armed[ctxKey('chat', null)]).toEqual([
      { providerID: 'p', modelID: 'm0' },
      { providerID: 'p', modelID: 'm1' }
    ])
    expect(panel()).toBeNull()
    open()
    press('Escape')
    expect(panel()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })
})
