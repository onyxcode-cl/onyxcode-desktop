// @vitest-environment jsdom
// Casillas de «Preparando Lazunox» con interacción real (F8-B197): marcar, desmarcar, instalar solo lo marcado y reintentar por fila.
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toggleChecked, type PreflightComponent, type PreflightId, type PreflightReport } from '@shared/preflight'
import { PreflightScreen } from './PreflightScreen'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const c = (id: PreflightComponent['id'], o: Partial<PreflightComponent> = {}): PreflightComponent => ({
  id,
  essential: ['storage', 'engine'].includes(id),
  ok: true,
  installable: id === 'craft' || id === 'runtimes',
  ...o
})
const REPORT: PreflightReport = {
  at: 1,
  platform: 'darwin',
  appVersion: '1.3.1',
  freeBytes: 50e9,
  components: [
    c('storage'),
    c('disk'),
    c('engine'),
    c('craft', { ok: false, reason: 'missing', sizeBytes: 205e6 }),
    c('runtimes', { ok: false, reason: 'missing', sizeBytes: 67e6 })
  ]
}

let host: HTMLDivElement
let root: Root
const noop = (): void => undefined

/** Pantalla con el estado de las casillas en vivo, como la puerta real. */
function Harness({ onInstall, failed }: { onInstall: (ids?: PreflightId[]) => void; failed?: boolean }): React.JSX.Element {
  const [unchecked, setUnchecked] = useState<PreflightId[]>([])
  return createElement(PreflightScreen, {
    report: REPORT,
    runtime: failed ? { craft: { state: 'failed', error: 'hash' } } : {},
    installing: false,
    details: {},
    copied: null,
    permsStalled: false,
    permsWaiting: false,
    unchecked,
    onToggle: (id: PreflightId) => setUnchecked((u) => toggleChecked(u, id)),
    onInstall,
    onCopy: noop,
    onContinue: noop,
    onRecheck: noop,
    onGrantPerms: noop,
    onPickEngine: noop
  })
}

const box = (id: string): HTMLInputElement => host.querySelector(`[data-testid="pick-${id}"]`) as HTMLInputElement
const btn = (re: RegExp): HTMLButtonElement | undefined => [...host.querySelectorAll('button')].find((b) => re.test(b.textContent ?? ''))

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

describe('PreflightScreen: casillas con interacción', () => {
  it('todo nace marcado; desmarcar ArtCraft baja el tamaño y el botón sigue activo', async () => {
    const onInstall = vi.fn()
    await act(async () => root.render(createElement(Harness, { onInstall })))
    expect(box('craft').checked).toBe(true)
    expect(box('runtimes').checked).toBe(true)
    expect(host.textContent).toContain('Se descargarán unos 272 MB.')
    await act(async () => box('craft').click())
    expect(box('craft').checked).toBe(false)
    expect(host.textContent).toContain('Se descargarán unos 67 MB.')
    // El botón pide «lo marcado» (sin ids): la puerta calcula el plan con las casillas.
    await act(async () => btn(/Instalar lo que falta/)!.click())
    expect(onInstall).toHaveBeenCalledWith()
  })
  it('sin nada marcado el botón se apaga y «Más tarde» sigue disponible', async () => {
    await act(async () => root.render(createElement(Harness, { onInstall: vi.fn() })))
    await act(async () => box('craft').click())
    await act(async () => box('runtimes').click())
    expect(btn(/Instalar lo que falta/)!.disabled).toBe(true)
    expect(host.textContent).toContain('No hay nada marcado')
    expect(btn(/Más tarde/)).toBeTruthy()
  })
  it('el reintento de una fila fallida pide solo ese componente', async () => {
    const onInstall = vi.fn()
    await act(async () => root.render(createElement(Harness, { onInstall, failed: true })))
    const row = host.querySelector('[data-testid="preflight-row-craft"]') as HTMLElement
    const retry = [...row.querySelectorAll('button')].find((b) => /Reintentar/.test(b.textContent ?? ''))!
    await act(async () => retry.click())
    expect(onInstall).toHaveBeenCalledWith(['craft'])
  })
})
