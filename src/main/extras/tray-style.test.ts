import { describe, expect, it } from 'vitest'
import { trayIconStyle } from './tray-style'

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
