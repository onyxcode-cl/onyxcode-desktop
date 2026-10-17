// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChipMenu, modLabel, type ChipMenuOption } from './ChipMenu'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const OPTIONS: ChipMenuOption[] = [
  { id: 'manual', label: 'Preguntar siempre', hint: 'Te pregunta antes de editar archivos o ejecutar comandos' },
  { id: 'auto', label: 'Automático', hint: 'Ediciones y comandos seguros sin preguntar' },
  { id: 'bypass', label: 'Todo sin preguntar', hint: 'Permite todo. Úsalo con cuidado.', tone: 'danger' }
]

let host: HTMLDivElement
let root: Root
const onSelect = vi.fn()

function mount(props: Partial<React.ComponentProps<typeof ChipMenu>> = {}): void {
  act(() => {
    root.render(
      createElement(ChipMenu, {
        name: 'Modo de permisos',
        valueLabel: 'Preguntar siempre',
        options: OPTIONS,
        value: 'manual',
        onSelect,
        collapseClass: 'inline desk:@max-[30rem]:sr-only',
        ...props
      })
    )
  })
}

beforeEach(() => {
  vi.unstubAllGlobals()
  delete (window as unknown as { api?: unknown }).api
  onSelect.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const trigger = (): HTMLButtonElement => host.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement
const menu = (): HTMLElement | null => host.querySelector('[role="menu"]')
const items = (): HTMLButtonElement[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]'))
const key = (el: Element, k: string, init: KeyboardEventInit = {}): void => {
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }))
  })
}

describe('ChipMenu: el chip', () => {
  it('muestra la etiqueta actual y su nombre accesible siempre dice el ajuste y el valor', () => {
    mount()
    expect(trigger().textContent).toContain('Preguntar siempre')
    expect(trigger().getAttribute('aria-label')).toBe('Modo de permisos: Preguntar siempre')
    expect(trigger().title).toBe('Modo de permisos: Preguntar siempre')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
  })

  it('responsive: la etiqueta pasa a solo ícono por clase de contenedor (sr-only) y nunca se quita del DOM', () => {
    mount()
    const label = Array.from(trigger().querySelectorAll('span')).find((s) => s.textContent === 'Preguntar siempre')!
    expect(label.className).toContain('desk:@max-[30rem]:sr-only')
    expect(trigger().getAttribute('aria-label')).toContain('Preguntar siempre')
  })

  it('el atajo del chip aparece en el title', () => {
    mount({ chipShortcut: '⇧Tab' })
    expect(trigger().title).toBe('Modo de permisos: Preguntar siempre (⇧Tab)')
  })

  it('un valor especial pinta el chip de peligro', () => {
    mount({ tone: 'danger', value: 'bypass', valueLabel: 'Todo sin preguntar' })
    expect(trigger().className).toContain('text-danger')
  })
})

describe('ChipMenu: el menú', () => {
  it('abre con rol menu, una frase por opción, la actual marcada y números como atajo', () => {
    mount()
    act(() => trigger().click())
    expect(menu()!.getAttribute('aria-label')).toBe('Modo de permisos')
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(items()[0]!.textContent).toContain('Te pregunta antes de editar archivos o ejecutar comandos')
    expect(items()[1]!.textContent).toContain('Ediciones y comandos seguros sin preguntar')
    expect(Array.from(host.querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['1', '2', '3'])
    expect(items()[2]!.className).toContain('text-danger')
  })

  it('al abrir el foco va a la opción actual', () => {
    mount({ value: 'auto' })
    act(() => trigger().click())
    expect(document.activeElement).toBe(items()[1])
  })

  it('↓ ↑ Inicio Fin recorren las opciones (circular)', () => {
    mount()
    act(() => trigger().click())
    key(items()[0]!, 'ArrowDown')
    expect(document.activeElement).toBe(items()[1])
    key(items()[1]!, 'End')
    expect(document.activeElement).toBe(items()[2])
    key(items()[2]!, 'ArrowDown')
    expect(document.activeElement).toBe(items()[0])
    key(items()[0]!, 'ArrowUp')
    expect(document.activeElement).toBe(items()[2])
    key(items()[2]!, 'Home')
    expect(document.activeElement).toBe(items()[0])
  })

  it('la flecha abajo en el chip lo abre', () => {
    mount()
    key(trigger(), 'ArrowDown')
    expect(menu()).not.toBeNull()
  })

  it('Esc cierra y devuelve el foco al chip', () => {
    mount()
    act(() => trigger().click())
    key(items()[0]!, 'Escape')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('elegir una opción llama a onSelect y cierra; elegir la actual no cambia nada', () => {
    mount()
    act(() => trigger().click())
    act(() => items()[1]!.click())
    expect(onSelect).toHaveBeenCalledWith('auto')
    expect(menu()).toBeNull()
    act(() => trigger().click())
    act(() => items()[0]!.click())
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('la tecla 3 elige la tercera opción', () => {
    mount()
    act(() => trigger().click())
    key(items()[0]!, '3')
    expect(onSelect).toHaveBeenCalledWith('bypass')
  })

  it('un clic fuera cierra el menú', () => {
    mount()
    act(() => trigger().click())
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(menu()).toBeNull()
  })

  it('deshabilitado no abre', () => {
    mount({ disabled: true })
    expect(trigger().disabled).toBe(true)
  })

  it('el menú tiene altura máxima con scroll (no se recorta con muchas opciones)', () => {
    mount()
    act(() => trigger().click())
    expect(menu()!.className).toContain('max-h-[min(34rem,calc(100vh-10rem))]')
    expect(menu()!.className).toContain('overflow-y-auto')
  })
})

describe('modLabel', () => {
  it('⌘ en Mac y Ctrl+ en Windows', () => {
    expect(modLabel()).toBe('⌘')
    ;(window as unknown as { api: { platform: string } }).api = { platform: 'win32' }
    expect(modLabel()).toBe('Ctrl+')
  })

  it('con shortLabel y shortClass muestra la etiqueta corta de la opción actual; sin shortClass queda solo el ícono', () => {
    const opts = OPTIONS.map((o) => ({ ...o, shortLabel: o.id === 'manual' ? 'Preguntar' : 'Otro' }))
    mount({ options: opts, shortClass: 'hidden desk:@max-[30rem]:inline' })
    const short = Array.from(trigger().querySelectorAll('span')).find((s) => s.textContent === 'Preguntar')!
    expect(short.className).toContain('desk:@max-[30rem]:inline')
    expect(trigger().getAttribute('aria-label')).toBe('Modo de permisos: Preguntar siempre')
    mount({ options: opts, shortClass: '' })
    expect(Array.from(trigger().querySelectorAll('span')).some((s) => s.textContent === 'Preguntar')).toBe(false)
  })
})
