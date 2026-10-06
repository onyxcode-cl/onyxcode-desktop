import { describe, expect, it, vi } from 'vitest'
import { requestAttention } from './attention'

describe('requestAttention', () => {
  it('macOS rebota el Dock y nada más', () => {
    const dockBounce = vi.fn()
    const flash = vi.fn()
    requestAttention({ platform: 'darwin', dockBounce, flash })
    expect(dockBounce).toHaveBeenCalledTimes(1)
    expect(flash).not.toHaveBeenCalled()
  })
  it('Windows parpadea la barra de tareas y nada más', () => {
    const dockBounce = vi.fn()
    const flash = vi.fn()
    requestAttention({ platform: 'win32', dockBounce, flash })
    expect(flash).toHaveBeenCalledTimes(1)
    expect(dockBounce).not.toHaveBeenCalled()
  })
  it('sin acción disponible no falla; otras plataformas no hacen nada', () => {
    expect(() => requestAttention({ platform: 'win32' })).not.toThrow()
    expect(() => requestAttention({ platform: 'darwin' })).not.toThrow()
    const flash = vi.fn()
    requestAttention({ platform: 'linux', flash, dockBounce: flash })
    expect(flash).not.toHaveBeenCalled()
  })
})
