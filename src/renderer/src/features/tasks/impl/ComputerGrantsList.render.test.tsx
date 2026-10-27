// @vitest-environment jsdom
/**
 * Listas de apps en Ajustes (Control del Mac/PC): «Bloqueadas por ti» con nombre legible y aria-label, «Quitar» llama undenyApp,
 * «Bloquear» (con confirmación) llama denyApp, sugeridas, bloqueadas fijas sin botón, es/en y Windows.
 */
import { vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
const denyApp = vi.hoisted(() => vi.fn(() => Promise.resolve()))
const undenyApp = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('./actions', () => ({
  denyApp,
  undenyApp,
  revokeAppGrant: vi.fn(() => Promise.resolve()),
  setAppGrant: vi.fn(() => Promise.resolve())
}))
vi.mock('./store', async () => {
  const { create } = await import('zustand')
  return { useTasks: create(() => ({ grants: null })), loadGrants: vi.fn() }
})
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setI18nPlatform, setLang } from '@shared/i18n'
import type { GrantsSnapshot } from '@shared/ipc-tasks'
import { useLang } from '../../../lib/i18n'
import { useTasks } from './store'
import { ComputerGrantsList } from './ComputerAccess'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

const SNAP: GrantsSnapshot = {
  grants: [{ bundleId: 'com.x.sheet', name: 'Hojas', tier: 'click', grantedAt: 1 }],
  denied: ['com.acme.cartera', 'com.old.thing'],
  deniedNames: { 'com.acme.cartera': 'Cartera Acme' }
}
const render = (p: 'darwin' | 'win32' = 'darwin', lang: 'es' | 'en' = 'es', snap: GrantsSnapshot = SNAP): void => {
  ;(window as unknown as { api: unknown }).api = { platform: p, capsFlags: {} }
  setI18nPlatform(p)
  setLang(lang)
  useLang.setState({ lang })
  act(() => {
    ;(useTasks as unknown as { setState: (s: unknown) => void }).setState({ grants: snap })
    root.render(createElement(ComputerGrantsList))
  })
}
const byLabel = (l: string): HTMLButtonElement => host.querySelector(`[aria-label="${l}"]`) as HTMLButtonElement
const click = async (el: Element): Promise<void> => {
  await act(async () => {
    ;(el as HTMLElement).click()
  })
}

beforeEach(() => {
  denyApp.mockClear()
  undenyApp.mockClear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
  setI18nPlatform('darwin')
})

describe('ComputerGrantsList', () => {
  it('«Bloqueadas por ti» muestra el nombre y la clave pequeña; «Quitar» lleva aria-label con la app y llama undenyApp', async () => {
    render()
    expect(host.textContent).toContain('Cartera Acme')
    expect(host.textContent).toContain('com.acme.cartera')
    expect(host.textContent).toContain('Thing') // bloqueo antiguo sin nombre guardado
    const b = byLabel('Quitar el bloqueo de Cartera Acme')
    expect(b.textContent).toContain('Quitar')
    await click(b)
    expect(undenyApp).toHaveBeenCalledWith('com.acme.cartera')
  })

  it('la lista de permisos usa «Quitar permiso», distinto de «Quitar»', () => {
    render()
    const r = byLabel('Quitar el permiso de Hojas')
    expect(r.textContent).toContain('Quitar permiso')
  })

  it('«Bloquear» pide confirmación con el efecto y solo entonces llama denyApp', async () => {
    render()
    await click(byLabel('Bloquear Hojas'))
    expect(denyApp).not.toHaveBeenCalled()
    expect(host.textContent).toContain('Lazunox no usará Hojas hasta que la quites de la lista')
    const yes = Array.from(host.querySelectorAll('button')).find((b) => /Sí, bloquear/.test(b.textContent ?? ''))!
    await click(yes)
    expect(denyApp).toHaveBeenCalledWith('com.x.sheet', 'Hojas')
  })

  it('cancelar la confirmación no bloquea', async () => {
    render()
    await click(byLabel('Bloquear Hojas'))
    await click(Array.from(host.querySelectorAll('button')).find((b) => b.textContent === 'Cancelar')!)
    expect(denyApp).not.toHaveBeenCalled()
  })

  it('sugeridas (macOS): se listan con «Bloquear», y una ya bloqueada desaparece', async () => {
    render()
    expect(host.textContent).toContain('Sugeridas para bloquear')
    expect(host.textContent).toContain('Ledger Live')
    await click(byLabel('Bloquear Ledger Live'))
    await click(Array.from(host.querySelectorAll('button')).find((b) => /Sí, bloquear/.test(b.textContent ?? ''))!)
    expect(denyApp).toHaveBeenCalledWith('com.ledger.live', 'Ledger Live')
    render('darwin', 'es', { ...SNAP, denied: [...SNAP.denied, 'com.ledger.live'] })
    expect(host.textContent).not.toContain('Ledger Live (')
    expect(byLabel('Bloquear Ledger Live')).toBeNull()
  })

  it('bloqueadas fijas: candado, frase y ningún botón', () => {
    render()
    const fixed = host.querySelector('[data-testid="fixed-blocked"]')!
    expect(fixed.textContent).toContain('Bloqueadas por seguridad: no se pueden desbloquear')
    expect(fixed.textContent).toContain('LastPass')
    expect(fixed.querySelector('button')).toBeNull()
  })

  it('Windows: fijas de Windows, frase del PC, sin sugeridas ni menciones del Mac', () => {
    render('win32')
    const fixed = host.querySelector('[data-testid="fixed-blocked"]')!
    expect(fixed.textContent).toContain('Editor del Registro')
    expect(fixed.textContent).toContain('Administrador de tareas')
    expect(fixed.textContent).toContain('Windows')
    expect(fixed.textContent).not.toMatch(/\bMac\b/)
    expect(fixed.querySelector('button')).toBeNull()
    expect(host.textContent).not.toContain('Sugeridas para bloquear')
  })

  it('inglés', () => {
    render('darwin', 'en')
    expect(byLabel('Remove the block on Cartera Acme').textContent).toContain('Remove')
    expect(byLabel('Block Hojas').textContent).toContain('Block')
    expect(host.textContent).toContain('Suggested to block')
    expect(host.textContent).toContain('Blocked for security: they cannot be unblocked')
  })
})
