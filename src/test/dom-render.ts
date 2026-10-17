/** Ayudas mínimas para pruebas de componentes en jsdom con react-dom (sin Testing Library, que el proyecto no usa). */
import './jsdom-first'
import { act, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export interface Mounted {
  host: HTMLDivElement
  rerender: (el: ReactElement) => void
  unmount: () => void
  /** Primer elemento que cumple el selector, dentro del documento (los diálogos viven fuera de `host`). */
  q: <T extends Element = HTMLElement>(sel: string) => T | null
  qa: <T extends Element = HTMLElement>(sel: string) => T[]
}

export function mount(el: ReactElement): Mounted {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root: Root = createRoot(host)
  act(() => root.render(el))
  return {
    host,
    rerender: (next) => act(() => root.render(next)),
    unmount: () => {
      act(() => root.unmount())
      host.remove()
    },
    q: <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel),
    qa: <T extends Element = HTMLElement>(sel: string) => Array.from(document.querySelectorAll<T>(sel))
  }
}

export function click(el: Element | null): void {
  if (!el) throw new Error('click: elemento ausente')
  act(() => void el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))
}

/** Escribe en un `input`/`textarea` controlado por React. */
export function typeInto(el: HTMLInputElement | HTMLTextAreaElement | null, value: string): void {
  if (!el) throw new Error('typeInto: elemento ausente')
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  act(() => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

export function pressKey(target: EventTarget, key: string): void {
  act(() => void target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })))
}
