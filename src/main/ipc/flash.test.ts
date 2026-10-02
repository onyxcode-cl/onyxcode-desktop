import { describe, expect, it } from 'vitest'
import { shouldFlashFrame } from './flash'

describe('shouldFlashFrame', () => {
  const bg = { isFocused: false, isDestroyed: false }
  it('solo en Windows, con la ventana en segundo plano', () => {
    expect(shouldFlashFrame('win32', bg)).toBe(true)
    expect(shouldFlashFrame('darwin', bg)).toBe(false)
    expect(shouldFlashFrame('linux', bg)).toBe(false)
  })
  it('no parpadea con foco, destruida, sin ventana o sin pendientes', () => {
    expect(shouldFlashFrame('win32', { isFocused: true, isDestroyed: false })).toBe(false)
    expect(shouldFlashFrame('win32', { isFocused: false, isDestroyed: true })).toBe(false)
    expect(shouldFlashFrame('win32', null)).toBe(false)
    expect(shouldFlashFrame('win32', bg, false)).toBe(false)
  })
})
