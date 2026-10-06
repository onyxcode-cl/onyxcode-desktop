import { describe, expect, it } from 'vitest'
import { trayIconReps, trayIconStyle } from './tray-style'

describe('trayIconStyle', () => {
  it('macOS: plantilla negra', () => {
    expect(trayIconStyle('darwin')).toEqual({ rgb: [0, 0, 0], template: true })
  })
  it.each(['win32', 'linux'])('%s: icono a color, no plantilla (el negro sería invisible en barras oscuras)', (p) => {
    const s = trayIconStyle(p)
    expect(s.template).toBe(false)
    expect(s.rgb).not.toEqual([0, 0, 0])
    expect(Math.max(...s.rgb)).toBeGreaterThan(100)
  })
})

describe('trayIconReps', () => {
  it('macOS: un solo bitmap de 32 px a escala 2 (sin cambios)', () => {
    expect(trayIconReps('darwin')).toEqual([{ size: 32, scaleFactor: 2 }])
  })
  it('Windows: 16/20/24/32 px a 100/125/150/200 %', () => {
    expect(trayIconReps('win32')).toEqual([
      { size: 16, scaleFactor: 1 },
      { size: 20, scaleFactor: 1.25 },
      { size: 24, scaleFactor: 1.5 },
      { size: 32, scaleFactor: 2 }
    ])
  })
})
