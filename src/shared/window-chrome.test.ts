import { describe, expect, it } from 'vitest'
import { BRAND_COLORS } from './brand'
import { TITLEBAR_HEIGHT, WIN_CONTROLS_FALLBACK_WIDTH, controlsInsetRight, overlayFor, titleBarOptions } from './window-chrome'

describe('titleBarOptions', () => {
  it('macOS: hiddenInset con semáforos y sin overlay (igual que antes)', () => {
    expect(titleBarOptions('darwin', { dark: true })).toEqual({ titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } })
  })
  it('Linux: marco estándar sin overlay (igual que antes)', () => {
    expect(titleBarOptions('linux', { dark: false })).toEqual({ titleBarStyle: 'default', trafficLightPosition: { x: 16, y: 16 } })
  })
  it('Windows: hidden + overlay de 48 px con colores del tema', () => {
    const light = titleBarOptions('win32', { dark: false })
    expect(light.titleBarStyle).toBe('hidden')
    expect(light.titleBarOverlay).toEqual({ color: BRAND_COLORS.bgLight, symbolColor: '#131722', height: TITLEBAR_HEIGHT })
    expect(titleBarOptions('win32', { dark: true }).titleBarOverlay).toEqual({
      color: BRAND_COLORS.bgDark,
      symbolColor: '#e7e9f0',
      height: 48
    })
  })
  it('solo Windows lleva titleBarOverlay', () => {
    for (const p of ['darwin', 'linux', 'freebsd']) expect(titleBarOptions(p, { dark: true }).titleBarOverlay).toBeUndefined()
  })
})

describe('overlayFor', () => {
  it('alto contraste: blanco/negro puros según el tema', () => {
    expect(overlayFor({ dark: true, highContrast: true })).toEqual({ color: '#000000', symbolColor: '#ffffff', height: 48 })
    expect(overlayFor({ dark: false, highContrast: true })).toEqual({ color: '#ffffff', symbolColor: '#000000', height: 48 })
  })
})

describe('controlsInsetRight', () => {
  it('0 fuera de Windows, aunque haya rectángulo', () => {
    expect(controlsInsetRight('darwin', null, 1280)).toBe(0)
    expect(controlsInsetRight('linux', { x: 0, width: 1142 }, 1280)).toBe(0)
  })
  it('Windows sin API: reserva por defecto', () => {
    expect(controlsInsetRight('win32', null, 1280)).toBe(WIN_CONTROLS_FALLBACK_WIDTH)
  })
  it('Windows con API: lo que queda a la derecha del área de título', () => {
    expect(controlsInsetRight('win32', { x: 0, width: 1142 }, 1280)).toBe(138)
    expect(controlsInsetRight('win32', { x: 0, width: 1160 }, 1280)).toBe(120)
  })
  it('Windows en pantalla completa (overlay oculto): 0', () => {
    expect(controlsInsetRight('win32', { x: 0, width: 1280 }, 1280, false)).toBe(0)
    expect(controlsInsetRight('win32', { x: 0, width: 1400 }, 1280)).toBe(0)
  })
})
