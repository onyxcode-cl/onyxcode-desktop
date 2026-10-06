import { describe, expect, it, vi } from 'vitest'
import { syncTitleBarOverlay } from './window-overlay'

const win = (destroyed = false) => ({ isDestroyed: () => destroyed, setTitleBarOverlay: vi.fn() })

describe('syncTitleBarOverlay', () => {
  it('Windows: actualiza colores según el tema', () => {
    const w = win()
    expect(syncTitleBarOverlay(w, { shouldUseDarkColors: true }, 'win32')).toBe(true)
    expect(w.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#11131a', symbolColor: '#e7e9f0', height: 48 })
    syncTitleBarOverlay(w, { shouldUseDarkColors: false }, 'win32')
    expect(w.setTitleBarOverlay).toHaveBeenLastCalledWith({ color: '#f7f8fb', symbolColor: '#131722', height: 48 })
  })
  it('alto contraste', () => {
    const w = win()
    syncTitleBarOverlay(w, { shouldUseDarkColors: true, shouldUseHighContrastColors: true }, 'win32')
    expect(w.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#000000', symbolColor: '#ffffff', height: 48 })
  })
  it('macOS y Linux: no toca nada', () => {
    for (const p of ['darwin', 'linux']) {
      const w = win()
      expect(syncTitleBarOverlay(w, { shouldUseDarkColors: true }, p)).toBe(false)
      expect(w.setTitleBarOverlay).not.toHaveBeenCalled()
    }
  })
  it('ventana destruida, nula o que lanza: no falla', () => {
    expect(syncTitleBarOverlay(null, { shouldUseDarkColors: true }, 'win32')).toBe(false)
    expect(syncTitleBarOverlay(win(true), { shouldUseDarkColors: true }, 'win32')).toBe(false)
    const bad = {
      isDestroyed: () => false,
      setTitleBarOverlay: () => {
        throw new Error('x')
      }
    }
    expect(syncTitleBarOverlay(bad, { shouldUseDarkColors: true }, 'win32')).toBe(false)
  })
})
