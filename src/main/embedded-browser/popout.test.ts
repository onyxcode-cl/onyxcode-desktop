/**
 * Vuelta automática del navegador desde la ventana aparte al panel (Control total): solo el popout que abrió el agente
 * con la principal oculta regresa; el que pidió el usuario a mano se queda donde está.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false }, BrowserWindow: class {} }))
vi.mock('../extras/windows', () => ({ extrasWindows: new Set(), loadRendererPage: async () => undefined, preloadPath: () => '' }))
vi.mock('../ipc/guard', () => ({ registerWindowRole: () => undefined }))

import { isAutoPopoutFromPanel, planAutoPopoutReturn } from './popout'

describe('isAutoPopoutFromPanel', () => {
  it('solo es automático si el panel estaba visible en la ventana principal', () => {
    expect(isAutoPopoutFromPanel('panel', true)).toBe(true)
    expect(isAutoPopoutFromPanel('panel', false)).toBe(true)
    expect(isAutoPopoutFromPanel('none', true)).toBe(true)
    expect(isAutoPopoutFromPanel('popout', true)).toBe(false)
  })
})

describe('planAutoPopoutReturn', () => {
  it('con la principal todavía oculta no devuelve nada', () => {
    const owners = [{ hostKind: 'popout' as const, popoutAuto: true }]
    expect(planAutoPopoutReturn(owners, false)).toEqual({ reclaim: [], close: false })
  })

  it('devuelve el popout automático al panel y cierra la ventana aparte', () => {
    const a = { hostKind: 'popout' as const, popoutAuto: true }
    const b = { hostKind: 'none' as const, popoutAuto: false }
    const plan = planAutoPopoutReturn([a, b], true)
    expect(plan.reclaim).toEqual([a])
    expect(plan.close).toBe(true)
  })

  it('un popout pedido a mano por el usuario no se toca ni se cierra', () => {
    const manual = { hostKind: 'popout' as const, popoutAuto: false }
    expect(planAutoPopoutReturn([manual], true)).toEqual({ reclaim: [], close: false })
  })

  it('no cierra la ventana aparte si otro owner la tiene abierta a propósito', () => {
    const auto = { hostKind: 'popout' as const, popoutAuto: true }
    const manual = { hostKind: 'popout' as const, popoutAuto: false }
    const plan = planAutoPopoutReturn([auto, manual], true)
    expect(plan.reclaim).toEqual([auto])
    expect(plan.close).toBe(false)
  })
})
