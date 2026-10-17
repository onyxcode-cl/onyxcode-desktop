// @vitest-environment jsdom
/**
 * Barra de pestañas de la terminal de Code y la integración de ▶ (`ShellRunProvider`) con varias pestañas: registro REAL (xterm real)
 * con un pty simulado. Las pestañas sobreviven a desmontar y volver a montar el panel (como la terminal de siempre).
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    ptys: [] as Array<{ id: string; written: string[]; killed: boolean }>,
    onData: new Set<(ev: { id: string; data: string }) => void>(),
    n: 0
  }
  const emit = (id: string, data: string): void => state.onData.forEach((f) => f({ id, data }))
  const api = {
    onPtyData: (f: (ev: { id: string; data: string }) => void) => {
      state.onData.add(f)
      return () => state.onData.delete(f)
    },
    onPtyExit: () => () => undefined,
    pty: {
      create: vi.fn(async () => {
        const id = `pty-${++state.n}`
        state.ptys.push({ id, written: [], killed: false })
        setTimeout(() => emit(id, `${id} % `), 1)
        return { id, pid: 1, cwd: '/p' }
      }),
      write: vi.fn(async (id: string, data: string) => {
        state.ptys.find((p) => p.id === id)?.written.push(data)
      }),
      resize: vi.fn(async () => undefined),
      kill: vi.fn(async (id: string) => {
        const p = state.ptys.find((x) => x.id === id)
        if (p) p.killed = true
      })
    }
  }
  return { state, emit, api }
})
vi.mock('../client', () => ({ requireCode: () => h.api, errorMessage: (e: unknown) => String(e) }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

import { TerminalPanel } from './TerminalPanel'
import { ShellRunProvider } from '../ShellRunProvider'
import { ShellRunContext, type ShellRunner } from '../../../../lib/shellRun'
import { useContext } from 'react'
import { useCode } from '../store'
import { MAX_TABS, disposeTerminalsExcept, getTabs, getTerminal } from './terminalRegistry'

let host: HTMLDivElement
let root: Root
let runner: ShellRunner | null = null
const tick = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms))
const tabs = (): HTMLElement[] => Array.from(host.querySelectorAll('[data-testid="terminal-tab"]'))
const names = (): string[] => tabs().map((t) => t.querySelector('[role="tab"]')?.textContent ?? '')
const newBtn = (): HTMLButtonElement => host.querySelector('[data-testid="terminal-new-tab"]') as HTMLButtonElement
const mount = (): void => act(() => root.render(createElement(TerminalPanel, { directory: '/p', visible: true })))

function Capture(): null {
  runner = useContext(ShellRunContext)
  return null
}

beforeEach(() => {
  vi.unstubAllGlobals()
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined
  }))
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe(): void {}
    disconnect(): void {}
  }
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  disposeTerminalsExcept(null)
  h.state.ptys.length = 0
  h.state.n = 0
  runner = null
  vi.unstubAllGlobals()
})

describe('barra de pestañas', () => {
  it('una pestaña al empezar, sin «x» (la última no se cierra), con «+»', async () => {
    mount()
    await act(() => tick())
    expect(names()).toEqual(['Terminal 1'])
    expect(host.querySelector('[data-testid="terminal-tab-close"]')).toBeNull()
    expect(host.querySelector('[role="tablist"]')?.getAttribute('aria-label')).toBe('Pestañas de la terminal')
    expect(newBtn().disabled).toBe(false)
  })

  it('«+» abre y selecciona otra; clic en una pestaña la selecciona; «x» la cierra y mata su pty', async () => {
    mount()
    await act(() => tick())
    act(() => newBtn().click())
    await act(() => tick())
    expect(names()).toEqual(['Terminal 1', 'Terminal 2'])
    expect(tabs()[1].getAttribute('data-active')).toBe('true')
    expect(host.querySelectorAll('[data-testid="terminal-tab-close"]')).toHaveLength(2)
    // Solo la pestaña seleccionada cuelga del contenedor.
    const body = host.querySelector('.min-h-0.flex-1.px-2') as HTMLElement
    expect(body.children).toHaveLength(1)
    expect(body.firstElementChild).toBe(getTerminal('/p').el)

    act(() => (tabs()[0].querySelector('[role="tab"]') as HTMLButtonElement).click())
    expect(tabs()[0].getAttribute('data-active')).toBe('true')
    expect(body.firstElementChild).toBe(getTerminal('/p').el)
    expect(getTerminal('/p').ptyId).toBe('pty-1')

    act(() => (tabs()[1].querySelector('[data-testid="terminal-tab-close"]') as HTMLButtonElement).click())
    expect(names()).toEqual(['Terminal 1'])
    expect(h.state.ptys.map((p) => p.killed)).toEqual([false, true])
    expect(host.querySelector('[data-testid="terminal-tab-close"]')).toBeNull()
  })

  it('el «+» se desactiva con el tope de pestañas', async () => {
    mount()
    for (let i = 1; i < MAX_TABS; i++) act(() => newBtn().click())
    await act(() => tick())
    expect(tabs()).toHaveLength(MAX_TABS)
    expect(newBtn().disabled).toBe(true)
    expect(newBtn().getAttribute('aria-label')).toBe(`Máximo de ${MAX_TABS} pestañas`)
  })

  it('renombrar con doble clic; vacío vuelve al nombre por defecto', async () => {
    mount()
    await act(() => tick())
    // jsdom no trae `oninput` y React cae en su ruta antigua de IE: se le dan estos dos métodos vacíos.
    Object.assign(HTMLElement.prototype, { attachEvent: () => undefined, detachEvent: () => undefined })
    const dbl = (): void =>
      act(() => {
        tabs()[0]
          .querySelector('[role="tab"]')
          ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
      })
    dbl()
    const input = host.querySelector('input[aria-label="Cambiar el nombre de la pestaña"]') as HTMLInputElement
    expect(input).not.toBeNull()
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    set.call(input, 'servidor')
    act(() => input.blur())
    expect(names()).toEqual(['servidor'])
    expect(getTabs('/p').tabs[0].title).toBe('servidor')
  })

  it('atajos: Ctrl+Mayús+T abre, Ctrl+RePág/AvPág cambia, Ctrl+Mayús+W cierra', async () => {
    mount()
    await act(() => tick())
    const press = (code: string, shift: boolean): void =>
      act(() => {
        host
          .querySelector('[data-testid="terminal-tabs"]')
          ?.dispatchEvent(new KeyboardEvent('keydown', { code, ctrlKey: true, shiftKey: shift, bubbles: true, cancelable: true }))
      })
    press('KeyT', true)
    expect(names()).toEqual(['Terminal 1', 'Terminal 2'])
    press('PageUp', false)
    expect(tabs()[0].getAttribute('data-active')).toBe('true')
    press('PageDown', false)
    expect(tabs()[1].getAttribute('data-active')).toBe('true')
    press('KeyW', true)
    expect(names()).toEqual(['Terminal 1'])
  })

  it('las pestañas sobreviven a desmontar y volver a montar el panel (cada shell sigue vivo)', async () => {
    mount()
    await act(() => tick())
    act(() => newBtn().click())
    await act(() => tick())
    act(() => root.render(createElement('div')))
    expect(h.state.ptys.every((p) => !p.killed)).toBe(true)
    mount()
    expect(names()).toEqual(['Terminal 1', 'Terminal 2'])
    expect(tabs()[1].getAttribute('data-active')).toBe('true')
    expect(h.state.ptys).toHaveLength(2)
  })
})

describe('▶ Ejecutar con pestañas (ShellRunProvider)', () => {
  const mountProvider = (): void =>
    act(() =>
      root.render(
        createElement(ShellRunProvider, {
          directory: '/p',
          children: [createElement(Capture, { key: 'c' }), createElement(TerminalPanel, { key: 'p', directory: '/p', visible: true })]
        })
      )
    )

  beforeEach(() => {
    useCode.setState({ directory: '/p', activeSessionID: null, panel: 'terminal' } as never)
  })
  afterEach(() => useCode.setState({ directory: null, panel: null } as never))

  it('corre en la pestaña seleccionada; si está ocupada devuelve null; con newTab usa otra y la selecciona', async () => {
    mountProvider()
    await act(() => tick(120))
    const first = runner!.run(['sleep 5'])
    expect(first).not.toBeNull()
    expect(first?.tabId).toBe(getTabs('/p').tabs[0].id)
    await act(() => tick(10))
    expect(runner!.run(['echo otra'])).toBeNull()
    expect(h.state.ptys[0].written.join('')).not.toContain('echo otra')
    const second = runner!.run(['echo otra'], { newTab: true })
    expect(second).not.toBeNull()
    expect(second?.tabId).not.toBe(first?.tabId)
    await act(() => tick(400))
    expect(names()).toEqual(['Terminal 1', 'Terminal 2'])
    expect(tabs()[1].getAttribute('data-active')).toBe('true')
    // Cada comando fue a SU shell.
    expect(h.state.ptys[0].written.join('')).toContain('sleep 5')
    expect(h.state.ptys[0].written.join('')).not.toContain('echo otra')
    expect(h.state.ptys[1].written.join('')).toContain('echo otra')
    expect(runner!.find(['echo otra'])).toBe(second)
  })

  it('showTerminal(tabId) selecciona esa pestaña', async () => {
    mountProvider()
    await act(() => tick(120))
    const firstId = getTabs('/p').tabs[0].id
    runner!.run(['sleep 5'])
    runner!.run(['echo b'], { newTab: true })
    await act(() => tick(50))
    expect(getTabs('/p').activeId).not.toBe(firstId)
    act(() => runner!.showTerminal(firstId))
    expect(getTabs('/p').activeId).toBe(firstId)
    await act(() => tick(50))
  })
})
