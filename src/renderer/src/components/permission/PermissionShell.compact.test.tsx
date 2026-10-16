// @vitest-environment jsdom
/**
 * Tarjetas de aprobación compactas (escritorio): resumen de una línea, botones de decisión siempre a la vista
 * y detalles plegados («Ver detalles»), abiertos de entrada cuando el resumen no muestra todo lo que se aprueba.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from 'lucide-react'
import { PermCardFrame, PermPreview, previewFits } from './PermissionShell'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.unstubAllGlobals()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function show(command: string, open: boolean): void {
  act(() => {
    root.render(
      createElement(
        PermCardFrame,
        {
          id: 'x1',
          danger: false,
          armed: true,
          busy: false,
          icon: Terminal,
          title: 'El agente quiere ejecutar un comando',
          effect: 'Se ejecutará en tu equipo',
          preview: createElement(PermPreview, { text: command, prompt: true }),
          details: createElement('pre', { 'data-testid': 'full' }, command),
          detailsOpen: open,
          onKeyDown: () => undefined
        },
        createElement('button', { type: 'button' }, 'Permitir una vez')
      )
    )
  })
}
const toggle = (): HTMLButtonElement => host.querySelector('button[aria-expanded]') as HTMLButtonElement
const details = (): HTMLElement => host.querySelector('#perm-details-x1') as HTMLElement

describe('tarjeta de aprobación compacta', () => {
  it('cerrada: resumen visible, detalle oculto, botón de decisión a la vista y aria-expanded=false', () => {
    show('npm install', false)
    expect(host.textContent).toContain('npm install')
    expect(toggle().getAttribute('aria-expanded')).toBe('false')
    expect(toggle().getAttribute('aria-controls')).toBe('perm-details-x1')
    expect(toggle().textContent).toContain('Ver detalles')
    expect(details().hidden).toBe(true)
    expect(host.textContent).toContain('Permitir una vez')
    expect(host.querySelector('[role="alertdialog"]')?.getAttribute('aria-labelledby')).toBe('perm-title-x1')
  })

  it('el botón abre y cierra el detalle (clic y teclado) y no toca el resto', () => {
    show('npm install', false)
    act(() => toggle().click())
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(details().hidden).toBe(false)
    expect(toggle().textContent).toContain('Ocultar detalles')
    act(() => toggle().click())
    expect(details().hidden).toBe(true)
    expect(host.textContent).toContain('Permitir una vez')
  })

  it('abierta de entrada cuando el comando no cabe en una línea', () => {
    const long = 'echo uno\necho dos'
    show(long, !previewFits(long, false))
    expect(toggle().getAttribute('aria-expanded')).toBe('true')
    expect(details().hidden).toBe(false)
    expect(details().textContent).toContain('echo dos')
    // El resumen nunca esconde que hay más líneas.
    expect(host.querySelector('p.font-mono')?.textContent ?? '').toContain('…')
  })

  it('el resumen conserva el comando completo en el título (accesible sin desplegar)', () => {
    show('rm -rf temporales/*', false)
    expect(host.querySelector('[title="rm -rf temporales/*"]')).not.toBeNull()
  })
})

describe('previewFits', () => {
  it('cabe: una línea corta y sin caracteres ocultos', () => {
    expect(previewFits('ls -la', false)).toBe(true)
  })
  it('no cabe: varias líneas, larga o con caracteres ocultos', () => {
    expect(previewFits('a\nb', false)).toBe(false)
    expect(previewFits('x'.repeat(200), false)).toBe(false)
    expect(previewFits('ls', true)).toBe(false)
  })
})
