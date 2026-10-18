// @vitest-environment jsdom
// Vista previa del resumen en «Resultados por revisar» (F8-B197): ~5 líneas sin barra de desplazamiento y «Ver todo» que expande la tarjeta.
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RoutineInboxItem } from '@shared/ipc-tasks'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./schedule', async (importOriginal) => ({ ...(await importOriginal<typeof import('./schedule')>()), fullDate: () => 'FECHA' }))

import { InboxCard } from './RoutineInbox'

const LONG = Array.from({ length: 14 }, (_, i) => `- punto ${i + 1} del informe`).join('\n')
const item = (summary: string): RoutineInboxItem => ({
  id: 'i1',
  kind: 'result',
  routineId: 'r1',
  routineName: 'Informe semanal',
  status: 'pending',
  createdAt: 1,
  runStatus: 'success',
  summary
})

let host: HTMLDivElement
let root: Root
/** jsdom no maqueta: se simula que el texto largo no cabe (alto real 300 px, visible 152 px) y el corto sí. */
let overflowing = true

beforeEach(() => {
  vi.unstubAllGlobals()
  overflowing = true
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => (overflowing ? 300 : 40) })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => (overflowing ? 152 : 40) })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight
})

const mount = async (summary: string): Promise<void> => {
  await act(async () => {
    root.render(createElement('ul', null, createElement(InboxCard, { item: item(summary) })))
  })
}
const summary = (): HTMLElement => host.querySelector('[data-testid="inbox-summary"]') as HTMLElement
const toggle = (): HTMLButtonElement | null => host.querySelector('[data-testid="inbox-summary-toggle"]')

describe('Resultados por revisar: vista previa del resumen', () => {
  it('cerrada recorta a unas 5 líneas SIN barra de desplazamiento y ofrece «Ver todo»', async () => {
    await mount(LONG)
    const cls = summary().className
    expect(cls).toContain('max-h-[9.5rem]')
    expect(cls).toContain('overflow-hidden')
    expect(cls).not.toMatch(/overflow-y-auto|overflow-auto|overflow-scroll/)
    expect(summary().dataset.expanded).toBe('false')
    expect(toggle()!.textContent).toContain('Ver todo')
  })

  it('el botón es accesible: aria-expanded y aria-controls apuntan al texto que expande', async () => {
    await mount(LONG)
    const b = toggle()!
    expect(b.getAttribute('aria-expanded')).toBe('false')
    expect(b.getAttribute('aria-controls')).toBe(summary().id)
  })

  it('«Ver todo» expande la tarjeta sin altura máxima ni desplazamiento anidado, y «Ver menos» la vuelve a cerrar', async () => {
    await mount(LONG)
    await act(async () => toggle()!.click())
    expect(summary().dataset.expanded).toBe('true')
    expect(summary().className).not.toMatch(/max-h-|overflow-/)
    expect(toggle()!.getAttribute('aria-expanded')).toBe('true')
    expect(toggle()!.textContent).toContain('Ver menos')
    await act(async () => toggle()!.click())
    expect(summary().className).toContain('max-h-[9.5rem]')
    expect(toggle()!.textContent).toContain('Ver todo')
  })

  it('un resumen corto cabe entero: no hay «Ver todo» ni recorte con degradado', async () => {
    overflowing = false
    await mount('Moví 3 facturas a /pagadas')
    expect(toggle()).toBeNull()
    expect(summary().className).not.toContain('mask-image')
  })

  it('el texto completo está siempre en la página (el recorte es solo visual) y se puede copiar', async () => {
    await mount(LONG)
    expect(summary().textContent).toContain('punto 14 del informe')
    expect(host.querySelector('[aria-label="Copiar el resumen"]')).not.toBeNull()
  })
})
