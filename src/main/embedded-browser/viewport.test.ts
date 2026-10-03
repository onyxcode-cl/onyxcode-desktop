import { describe, expect, it } from 'vitest'
import {
  DESKTOP_VIEWPORT_WIDTH,
  MOBILE_VIEWPORT_WIDTH,
  computeEmulation,
  emulationKey,
  inputScaleOf,
  mobileUserAgent,
  scaleInputParams
} from './viewport'

describe('computeEmulation (viewport de escritorio por defecto)', () => {
  it('panel estrecho en escritorio: viewport de 1280 px escalado para caber', () => {
    const e = computeEmulation('desktop', 640, 400)
    expect(e).not.toBeNull()
    expect(e!.screenPosition).toBe('desktop')
    expect(e!.viewSize.width).toBe(DESKTOP_VIEWPORT_WIDTH)
    expect(e!.scale).toBeCloseTo(0.5, 5)
    expect(e!.viewSize.height).toBe(800) // la altura CSS compensa la escala: la vista nativa se llena entera
  })
  it('panel ancho en escritorio: sin emulación (ya es de escritorio)', () => {
    expect(computeEmulation('desktop', 1280, 700)).toBeNull()
    expect(computeEmulation('desktop', 1800, 700)).toBeNull()
  })
  it('móvil: 390 px CSS; con panel más estrecho también se escala', () => {
    const wide = computeEmulation('mobile', 800, 600)!
    expect(wide).toMatchObject({ screenPosition: 'mobile', scale: 1, viewSize: { width: MOBILE_VIEWPORT_WIDTH, height: 600 } })
    const narrow = computeEmulation('mobile', 195, 400)!
    expect(narrow.scale).toBeCloseTo(0.5, 5)
    expect(narrow.viewSize.height).toBe(800)
  })
  it('tamaños degenerados no producen NaN ni escala 0', () => {
    const e = computeEmulation('desktop', 0, 0)!
    expect(Number.isFinite(e.scale) && e.scale > 0).toBe(true)
  })
})

describe('emulationKey / inputScaleOf', () => {
  it('claves distintas por modo y tamaño; sin emulación escala 1', () => {
    const a = computeEmulation('desktop', 600, 500)
    const b = computeEmulation('desktop', 700, 500)
    expect(emulationKey('desktop', a)).not.toBe(emulationKey('desktop', b))
    expect(emulationKey('desktop', null)).not.toBe(emulationKey('mobile', null))
    expect(inputScaleOf(null)).toBe(1)
    expect(inputScaleOf(a)).toBeCloseTo(600 / 1280, 5)
  })
})

describe('scaleInputParams (CSS → píxeles de vista)', () => {
  it('escala x/y de ratón; deja intactos los demás campos y los comandos que no son de puntero', () => {
    expect(
      scaleInputParams('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1000, y: 200, button: 'left', clickCount: 1 }, 0.5)
    ).toEqual({
      type: 'mousePressed',
      x: 500,
      y: 100,
      button: 'left',
      clickCount: 1
    })
    const key = { type: 'keyDown', key: 'a' }
    expect(scaleInputParams('Input.dispatchKeyEvent', key, 0.5)).toBe(key)
    expect(scaleInputParams('Input.insertText', { text: 'x' }, 0.5)).toEqual({ text: 'x' })
  })
  it('escala 1 devuelve el mismo objeto; el táctil escala cada punto', () => {
    const p = { type: 'mouseMoved', x: 3, y: 4 }
    expect(scaleInputParams('Input.dispatchMouseEvent', p, 1)).toBe(p)
    expect(scaleInputParams('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 10, y: 20 }] }, 0.5)).toEqual({
      type: 'touchStart',
      touchPoints: [{ x: 5, y: 10 }]
    })
  })
  it('el user agent móvil no delata Electron y marca Mobile', () => {
    const ua = mobileUserAgent('140.0.7339.41')
    expect(ua).toMatch(/Mobile/)
    expect(ua).toMatch(/Chrome\/140\./)
    expect(ua).not.toMatch(/Electron/)
  })
})
