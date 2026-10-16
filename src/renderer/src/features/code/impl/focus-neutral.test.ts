import { describe, expect, it, vi } from 'vitest'
import { focusNeutral, hasKeyboardFocus } from './new-session-plus'

describe('foco neutro y foco de teclado', () => {
  it('focusNeutral enfoca el contenedor de la lista, no un botón', () => {
    const focus = vi.fn()
    const el = { focus }
    vi.stubGlobal('document', { querySelector: (sel: string) => (sel === '[data-session-list-root]' ? el : null) })
    focusNeutral()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
    vi.unstubAllGlobals()
  })

  it('hasKeyboardFocus consulta :focus-visible y, si no se puede saber, asume que sí', () => {
    expect(hasKeyboardFocus({ matches: (q: string) => q === ':focus-visible' } as unknown as Element)).toBe(true)
    expect(hasKeyboardFocus({ matches: () => false } as unknown as Element)).toBe(false)
    expect(
      hasKeyboardFocus({
        matches: () => {
          throw new Error('no soportado')
        }
      } as unknown as Element)
    ).toBe(true)
  })
})
