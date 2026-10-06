import { describe, expect, it } from 'vitest'
import { readControlsInset } from './window-controls'

describe('readControlsInset', () => {
  const api = (width: number, visible = true) => ({ visible, getTitlebarAreaRect: () => ({ x: 0, width }) })
  it('macOS/Linux: 0', () => {
    expect(readControlsInset('darwin', api(1142), 1280)).toBe(0)
    expect(readControlsInset('linux', null, 1280)).toBe(0)
  })
  it('Windows sin API: 138', () => expect(readControlsInset('win32', null, 1280)).toBe(138))
  it('Windows con API: lo que informa', () => expect(readControlsInset('win32', api(1150), 1280)).toBe(130))
  it('Windows con overlay oculto (pantalla completa): 0', () => expect(readControlsInset('win32', api(1280, false), 1280)).toBe(0))
  it('Windows con API que lanza: 138', () => {
    const bad = {
      visible: true,
      getTitlebarAreaRect: () => {
        throw new Error('x')
      }
    }
    expect(readControlsInset('win32', bad, 1280)).toBe(138)
  })
})
