import { describe, expect, it } from 'vitest'
import { applyViewport, computeViewport, KEYBOARD_MIN_INSET, mobileComposerMax } from './viewport'

describe('viewport móvil (teclado)', () => {
  it('sin visualViewport usa la altura de la ventana', () => {
    expect(computeViewport(800, null)).toEqual({ height: 800, top: 0, kb: 0 })
  })
  it('con teclado, el hueco es lo que la ventana tiene de más que el viewport visible', () => {
    expect(computeViewport(844, { height: 520, offsetTop: 0 })).toEqual({ height: 520, top: 0, kb: 324 })
  })
  it('si iOS desplaza el viewport, el hueco descuenta ese desplazamiento', () => {
    expect(computeViewport(844, { height: 500, offsetTop: 100 })).toEqual({ height: 500, top: 100, kb: 244 })
  })
  it('nunca negativo y marca el teclado solo por encima del umbral', () => {
    expect(computeViewport(800, { height: 810, offsetTop: 0 }).kb).toBe(0)
    const el = { style: { setProperty: () => undefined }, dataset: {} as Record<string, string> } as unknown as HTMLElement
    applyViewport(el, { height: 500, top: 0, kb: KEYBOARD_MIN_INSET })
    expect(el.dataset.keyboard).toBe('open')
    applyViewport(el, { height: 700, top: 0, kb: 60 })
    expect(el.dataset.keyboard).toBeUndefined()
  })
})

describe('mobileComposerMax', () => {
  it('38 % de lo visible con tope de 240 px', () => {
    expect(mobileComposerMax(844)).toBe(240)
    expect(mobileComposerMax(400)).toBe(152)
    expect(mobileComposerMax(1000)).toBe(240)
  })
})
