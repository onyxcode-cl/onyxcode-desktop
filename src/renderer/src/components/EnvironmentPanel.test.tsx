// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EnvironmentPanel, type EnvironmentPanelProps } from './EnvironmentPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  // `src/test/setup.ts` sustituye `window`/`document` por dobles mínimos: se restauran los del DOM (jsdom) de este archivo.
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const render = (p: Partial<EnvironmentPanelProps> = {}): void => {
  act(() => {
    root.render(createElement(EnvironmentPanel, { hostName: 'MacBook de Ben', directory: '/Users/ben/Documents/Proyecto', ...p }))
  })
}
const trigger = (): HTMLButtonElement => host.querySelector('button[aria-haspopup="dialog"]') as HTMLButtonElement
const dialog = (): HTMLElement | null => host.querySelector('[role="dialog"]')
const open = (): void => {
  act(() => trigger().click())
}

describe('EnvironmentPanel', () => {
  it('cerrado: solo el botón «Entorno» con aria-expanded=false', () => {
    render()
    expect(trigger().textContent).toBe('Entorno')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(dialog()).toBeNull()
  })

  it('abre con clic, mueve el foco al panel y marca aria-expanded', () => {
    render()
    open()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(dialog()).not.toBeNull()
    expect(document.activeElement).toBe(dialog())
    expect(dialog()!.getAttribute('id')).toBe(trigger().getAttribute('aria-controls'))
  })

  it('Esc cierra y devuelve el foco al botón', () => {
    render()
    open()
    act(() => {
      dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('un clic fuera cierra; un clic dentro no', () => {
    render()
    open()
    act(() => {
      dialog()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(dialog()).not.toBeNull()
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(dialog()).toBeNull()
  })

  it('muestra equipo y carpeta con la ruta abreviada con ~ (macOS)', () => {
    render()
    open()
    const text = dialog()!.textContent!
    expect(text).toContain('MacBook de Ben')
    expect(text).toContain('este equipo')
    expect(text).toContain('Proyecto')
    expect(host.querySelector('[data-testid="env-path"]')!.textContent).toBe('~/Documents/Proyecto')
  })

  it('ruta de Windows con \\ : se abrevia a ~ y conserva el separador', () => {
    render({ directory: 'C:\\Users\\ben\\Documents\\Proyecto' })
    open()
    expect(host.querySelector('[data-testid="env-path"]')!.textContent).toBe('~\\Documents\\Proyecto')
    expect(dialog()!.textContent).toContain('Proyecto')
  })

  it('ruta fuera de la carpeta personal se muestra completa', () => {
    render({ directory: 'D:\\trabajo\\app' })
    open()
    expect(host.querySelector('[data-testid="env-path"]')!.textContent).toBe('D:\\trabajo\\app')
  })

  it('sin rama (Tareas) no hay fila de rama; sin carpeta lo dice', () => {
    render({ directory: null })
    open()
    expect(dialog()!.textContent).not.toContain('Rama')
    expect(dialog()!.textContent).toContain('Sin carpeta elegida')
  })

  it('con rama y sin cambios dice «sin cambios»', () => {
    render({ branch: { name: 'main', changes: 0 } })
    open()
    expect(dialog()!.textContent).toContain('main')
    expect(dialog()!.textContent).toContain('sin cambios')
  })

  it('con rama y N cambios los cuenta (singular y plural)', () => {
    render({ branch: { name: 'feat/x', changes: 3 } })
    open()
    expect(dialog()!.textContent).toContain('3 cambios')
    render({ branch: { name: 'feat/x', changes: 1 } })
    expect(dialog()!.textContent).toContain('1 cambio')
    expect(dialog()!.textContent).not.toContain('1 cambios')
  })

  it('sin modo (Code) no hay botón «Cambiar» ni punto de restauración', () => {
    render({ branch: { name: 'main', changes: 0 } })
    open()
    expect(dialog()!.textContent).not.toContain('Cambiar')
    expect(dialog()!.textContent).not.toContain('restauración')
  })

  it('Solo en tu carpeta: muestra el modo, «Cambiar» llama a la acción y el punto está activo', () => {
    const onChange = vi.fn()
    render({ mode: { full: false, label: 'Solo en tu carpeta', otherLabel: 'Control total', onChange, restore: 'on' } })
    open()
    expect(dialog()!.textContent).toContain('Solo en tu carpeta')
    expect(dialog()!.textContent).toContain('activo')
    const btn = dialog()!.querySelector('button')!
    expect(btn.getAttribute('aria-label')).toBe('Cambiar a «Control total»')
    act(() => btn.click())
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('Control total sobre la carpeta personal: punto de restauración no disponible', () => {
    render({ mode: { full: true, label: 'Control total', otherLabel: 'Solo en tu carpeta', onChange: vi.fn(), restore: 'off' } })
    open()
    expect(dialog()!.textContent).toContain('Control total')
    expect(dialog()!.textContent).toContain('no disponible en Control total sobre la carpeta personal')
  })

  it('sin estado de restauración la fila se omite', () => {
    render({ mode: { full: false, label: 'Solo en tu carpeta', otherLabel: 'Control total', onChange: vi.fn() } })
    open()
    expect(dialog()!.textContent).not.toContain('restauración')
  })

  it('cambio bloqueado: botón deshabilitado y se explica el motivo', () => {
    const onChange = vi.fn()
    render({
      mode: {
        full: true,
        label: 'Control total',
        otherLabel: 'Solo en tu carpeta',
        onChange,
        blockedReason: 'Autoriza una carpeta primero.'
      }
    })
    open()
    const btn = dialog()!.querySelector('button')!
    expect(btn.disabled).toBe(true)
    expect(dialog()!.textContent).toContain('Autoriza una carpeta primero.')
    act(() => btn.click())
    expect(onChange).not.toHaveBeenCalled()
  })

  it('ocupado: «Cambiar» deshabilitado', () => {
    render({ mode: { full: false, label: 'Solo en tu carpeta', otherLabel: 'Control total', onChange: vi.fn(), busy: true } })
    open()
    expect(dialog()!.querySelector('button')!.disabled).toBe(true)
  })
})
