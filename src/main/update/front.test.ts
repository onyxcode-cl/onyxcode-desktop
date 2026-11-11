import { describe, expect, it, vi } from 'vitest'
import { bringToFront, consumeJustUpdated, markJustUpdated } from './front'

describe('ventana tras actualizar', () => {
  it('solo se marca si el reemplazo salió bien y es la versión que corre', () => {
    markJustUpdated(null, '1.8.19')
    markJustUpdated({ version: '1.8.19', ok: false }, '1.8.19')
    markJustUpdated({ version: '1.8.18', ok: true }, '1.8.19')
    expect(consumeJustUpdated()).toBe(false)
    markJustUpdated({ version: '1.8.19', ok: true }, '1.8.19')
    expect(consumeJustUpdated()).toBe(true)
    expect(consumeJustUpdated()).toBe(false) // una sola vez
  })

  const fakeWin = () => ({ show: vi.fn(), focus: vi.fn(), moveTop: vi.fn(), setAlwaysOnTop: vi.fn(), isDestroyed: () => false })

  it('Windows: «siempre encima» un instante y se suelta', () => {
    const w = fakeWin()
    bringToFront(w, 'win32', vi.fn())
    expect(w.setAlwaysOnTop.mock.calls).toEqual([[true], [false]])
    expect(w.focus).toHaveBeenCalled()
  })

  it('macOS: la app pasa al frente', () => {
    const w = fakeWin()
    const focusApp = vi.fn()
    bringToFront(w, 'darwin', focusApp)
    expect(focusApp).toHaveBeenCalled()
    expect(w.setAlwaysOnTop).not.toHaveBeenCalled()
  })
})
