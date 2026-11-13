import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: class {},
  nativeImage: { createFromBuffer: vi.fn() },
  session: {},
  WebContentsView: class {}
}))
vi.mock('./web-server', () => ({ startWebServer: vi.fn() }))

import { isNearlyBlankBitmap } from './web-view'

function bitmap(width: number, height: number, color: [number, number, number], speckles = 0): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const offset = i * 4
    const varied = i < speckles ? (color[0] + 100) % 255 : color[0]
    out[offset] = varied
    out[offset + 1] = color[1]
    out[offset + 2] = color[2]
    out[offset + 3] = 255
  }
  return out
}

describe('detector de panel casi uniforme', () => {
  it('detecta una captura blanca y tolera ruido menor', () => {
    expect(isNearlyBlankBitmap(bitmap(100, 80, [255, 255, 255], 20), 100, 80)).toBe(true)
  })

  it('no confunde una captura con contenido ni un bitmap inválido con blanco', () => {
    expect(isNearlyBlankBitmap(bitmap(100, 80, [255, 255, 255], 400), 100, 80)).toBe(false)
    expect(isNearlyBlankBitmap(new Uint8Array(4), 1, 1)).toBe(false)
  })
})
