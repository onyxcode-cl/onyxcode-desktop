// @vitest-environment jsdom
/**
 * Píldora: la respuesta a la tarjeta de permiso. «Permitir» manda `scope: 'session'` (como la tarjeta de la ventana), Esc y ✕
 * CANCELAN (no tocan ninguna concesión) y «Control total» pedido por el agente no viene preseleccionado.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => vi.unstubAllGlobals())
import type { AccessRequest, ComputerOverlayMessage } from '@shared/ipc-tasks'

const invoke = vi.fn(() => Promise.resolve({ ok: true }))
let overlayHandler: ((m: ComputerOverlayMessage) => void) | null = null

beforeAll(async () => {
  document.body.innerHTML = '<div id="root"></div>'
  ;(window as unknown as { api: unknown }).api = {
    platform: 'darwin',
    tasks: {
      invoke,
      on: (ch: string, fn: (m: ComputerOverlayMessage) => void) => {
        if (ch === 'computer:overlay') overlayHandler = fn
        return () => undefined
      }
    }
  }
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  })) as never
  await import('./pill')
})
beforeEach(() => invoke.mockClear())
afterEach(() => overlayHandler?.({ type: 'waitingCleared' }))

const show = (req: Partial<AccessRequest>): void =>
  overlayHandler?.({
    type: 'waiting',
    request: { id: 'r1', apps: [{ bundleId: 'com.x.sheet', name: 'Hojas', requested: 'click' }], ...req } as AccessRequest
  })
const last = (): { id: string; decisions: unknown; scope?: string; cancel?: boolean } =>
  (invoke.mock.calls.at(-1) as unknown as [string, never])[1]
const q = (sel: string): HTMLButtonElement => document.querySelector(sel) as HTMLButtonElement

describe('pill.ts (tarjeta de permiso)', () => {
  it('«Permitir» manda scope session con el nivel elegido', () => {
    show({})
    q('.req-approve').click()
    expect(invoke).toHaveBeenCalledWith('computer:respondAccess', expect.objectContaining({ id: 'r1', scope: 'session' }))
    expect(last().decisions).toEqual([{ bundleId: 'com.x.sheet', name: 'Hojas', decision: 'click' }])
  })

  it('Esc cancela (cancel:true, sin decisiones ni scope)', () => {
    show({})
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(last()).toMatchObject({ id: 'r1', decisions: [], cancel: true })
    expect(last().scope).toBeUndefined()
  })

  it('el ✕ también cancela', () => {
    show({})
    q('.req-close').click()
    expect(last()).toMatchObject({ decisions: [], cancel: true })
  })

  it('el agente pide Control total: viene «Ver y clic» y Permitir no lo concede', () => {
    show({ apps: [{ bundleId: 'a', name: 'Term', requested: 'full', current: null }] })
    expect(document.querySelector('.req-tier-full')?.classList.contains('active')).toBe(false)
    expect(document.querySelector('.req-tier-click')?.classList.contains('active')).toBe(true)
    q('.req-approve').click()
    expect(last().decisions).toEqual([{ bundleId: 'a', name: 'Term', decision: 'click' }])
  })
})
