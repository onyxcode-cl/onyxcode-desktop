/** Control detenido en el chat aislado (modo unificado): aviso con «Reanudar control»; sin la bandera y en Control total no cambia. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const o = vi.hoisted(() => ({ unified: false, patch: {} as Record<string, unknown> }))
vi.mock('./unified', async (orig) => {
  const mod = await orig<typeof import('./unified')>()
  return { ...mod, useUnifiedApps: () => o.unified }
})
vi.mock('./store', async (orig) => {
  const mod = await orig<typeof import('./store')>()
  const useTasks = Object.assign((sel: (s: unknown) => unknown) => sel({ ...mod.useTasks.getState(), ...o.patch }), mod.useTasks)
  return { ...mod, useTasks }
})

import { ControlBanner } from './ComputerAccess'

afterEach(() => {
  o.unified = false
  o.patch = {}
})
const html = (): string => renderToStaticMarkup(<ControlBanner />)
const isolated = { conn: { fullAccess: false }, folder: '/x/Chats/a', controlStoppedAt: 123 }

describe('ControlBanner en el chat aislado', () => {
  it('con la bandera y control detenido: «Reanudar control» y el texto de parada', () => {
    o.unified = true
    o.patch = isolated
    const h = html()
    expect(h).toContain('Reanudar control')
    expect(h).toContain('Control detenido')
    expect(h).toContain('El control del Mac está detenido')
  })
  it('con la bandera pero sin parada: nada', () => {
    o.unified = true
    o.patch = { ...isolated, controlStoppedAt: null }
    expect(html()).toBe('')
  })
  it('SIN la bandera y detenido en un chat aislado: nada (como siempre)', () => {
    o.patch = isolated
    expect(html()).toBe('')
  })
  it('Control total detenido: un solo aviso con su texto de siempre, con o sin bandera', () => {
    o.patch = { ...isolated, conn: { fullAccess: true } }
    for (const unified of [false, true]) {
      o.unified = unified
      const h = html()
      expect(h.match(/Reanudar control/g)).toHaveLength(1)
      expect(h).toContain('El agente no puede usar el ratón ni el teclado')
      expect(h).not.toContain('El control del Mac está detenido')
    }
  })
})
