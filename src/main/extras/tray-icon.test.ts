import { beforeEach, describe, expect, it, vi } from 'vitest'

const addRepresentation = vi.fn()
const createFromBitmap = vi.fn()
const setTemplateImage = vi.fn()
vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: {
    createEmpty: () => ({ addRepresentation, setTemplateImage }),
    createFromBitmap: (...a: unknown[]) => {
      createFromBitmap(...a)
      return { addRepresentation, setTemplateImage }
    }
  },
  Tray: class {}
}))

import { createTrayIcon, renderTrayBitmap } from './tray'

describe('createTrayIcon por plataforma', () => {
  beforeEach(() => {
    addRepresentation.mockClear()
    createFromBitmap.mockClear()
    setTemplateImage.mockClear()
  })

  it('win32: cuatro representaciones 16/20/24/32 px, no plantilla', () => {
    createTrayIcon('win32')
    expect(createFromBitmap).not.toHaveBeenCalled()
    const reps = addRepresentation.mock.calls.map(([r]) => r)
    expect(reps.map((r) => [r.width, r.height, r.scaleFactor])).toEqual([
      [16, 16, 1],
      [20, 20, 1.25],
      [24, 24, 1.5],
      [32, 32, 2]
    ])
    for (const r of reps) expect(r.buffer.length).toBe(r.width * r.height * 4)
    expect(setTemplateImage).toHaveBeenCalledWith(false)
  })

  it('darwin: un bitmap de 32 px a escala 2 como plantilla (idéntico a antes)', () => {
    createTrayIcon('darwin')
    expect(addRepresentation).not.toHaveBeenCalled()
    expect(createFromBitmap).toHaveBeenCalledTimes(1)
    const [buf, opts] = createFromBitmap.mock.calls[0]
    expect((buf as Buffer).length).toBe(32 * 32 * 4)
    expect(opts).toEqual({ width: 32, height: 32, scaleFactor: 2 })
    expect(setTemplateImage).toHaveBeenCalledWith(true)
  })

  it('el bitmap dibuja el símbolo a cualquier tamaño (hay píxeles opacos y transparentes)', () => {
    for (const s of [16, 20, 24, 32]) {
      const b = renderTrayBitmap(s, [1, 2, 3])
      const alphas = Array.from({ length: s * s }, (_, i) => b[i * 4 + 3])
      expect(alphas.some((a) => a === 255)).toBe(true)
      expect(alphas.some((a) => a === 0)).toBe(true)
    }
  })
})
