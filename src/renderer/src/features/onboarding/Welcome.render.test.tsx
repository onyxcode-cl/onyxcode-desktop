// @vitest-environment jsdom
// Paso 1 del primer uso: la bienvenida solo saluda. No revisa, no descarga ni enseña la lista de piezas (eso es el paso 2), igual en Mac y Windows.
import { StrictMode, act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const bridge = vi.fn()
vi.mock('../tasks/impl/bridge', () => ({
  hasTasksBridge: () => true,
  cw: (...a: unknown[]) => bridge(...a)
}))

import { Welcome } from './Welcome'

let host: HTMLDivElement
let root: Root

const mount = async (platform: string, onDone = vi.fn(), strict = false): Promise<typeof onDone> => {
  ;(window as unknown as { api: unknown }).api = { platform, capsFlags: { tasksWin: true } }
  const el = createElement(Welcome, { onDone })
  await act(async () => {
    root.render(strict ? createElement(StrictMode, null, el) : el)
  })
  return onDone
}

beforeEach(() => {
  vi.unstubAllGlobals()
  bridge.mockReset()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

describe.each(['darwin', 'win32'])('Welcome (%s): solo saluda', (platform) => {
  it('título, frase de qué viene y «Empezar» habilitado desde el primer momento', async () => {
    await mount(platform)
    expect(host.querySelector('h1')?.textContent).toContain('Bienvenido a')
    expect(host.textContent).toContain('pasos cortos')
    const start = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Empezar') as HTMLButtonElement
    expect(start.disabled).toBe(false)
  })
  it('no revisa ni descarga nada y no muestra casillas ni lista de piezas', async () => {
    await mount(platform)
    expect(bridge).not.toHaveBeenCalled()
    expect(host.querySelector('input[type="checkbox"]')).toBeNull()
    expect(host.querySelector('ul')).toBeNull()
    expect(host.textContent).not.toMatch(/ArtCraft|Node\.js/i)
  })
  it('«Empezar» pasa al siguiente paso', async () => {
    const onDone = await mount(platform)
    await act(async () => ([...host.querySelectorAll('button')].find((b) => b.textContent === 'Empezar') as HTMLButtonElement).click())
    expect(onDone).toHaveBeenCalledTimes(1)
  })
})

describe('Welcome: accesibilidad y ventana chica', () => {
  it('es un diálogo modal etiquetado por su título, con el foco en el título, y se puede desplazar', async () => {
    await mount('darwin', vi.fn(), true)
    const dialog = host.querySelector('[role="dialog"]')!
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.getAttribute('aria-labelledby')).toBe('welcome-title')
    expect(document.activeElement?.id).toBe('welcome-title')
    expect(host.querySelector('[data-testid="welcome-screen"]')!.className).toContain('overflow-y-auto')
  })
})
