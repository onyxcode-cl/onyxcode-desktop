import { describe, expect, it } from 'vitest'
import { ZOOM_MAX, ZOOM_MIN, clampPage, scaleOf, zoomIn, zoomOut } from './zoom'

describe('zoomIn', () => {
  it('sube al paso siguiente', () => {
    expect(zoomIn(100)).toBe(125)
    expect(zoomIn(90)).toBe(100)
  })
  it('en el tope, se queda en el tope', () => {
    expect(zoomIn(400)).toBe(ZOOM_MAX)
    expect(zoomIn(500)).toBe(ZOOM_MAX)
  })
})

describe('zoomOut', () => {
  it('baja al paso anterior', () => {
    expect(zoomOut(100)).toBe(75)
    expect(zoomOut(130)).toBe(125)
  })
  it('en el mínimo, se queda en el mínimo', () => {
    expect(zoomOut(50)).toBe(ZOOM_MIN)
    expect(zoomOut(10)).toBe(ZOOM_MIN)
  })
})

describe('clampPage', () => {
  it('dentro de rango, igual', () => {
    expect(clampPage(3, 10)).toBe(3)
  })
  it('fuera de rango, recorta a los bordes', () => {
    expect(clampPage(0, 10)).toBe(1)
    expect(clampPage(-5, 10)).toBe(1)
    expect(clampPage(99, 10)).toBe(10)
  })
  it('redondea decimales', () => {
    expect(clampPage(3.6, 10)).toBe(4)
  })
  it('documento vacío (total 0): siempre 1', () => {
    expect(clampPage(5, 0)).toBe(1)
  })
})

describe('scaleOf', () => {
  it('convierte porcentaje a fracción', () => {
    expect(scaleOf(150)).toBe(1.5)
    expect(scaleOf(100)).toBe(1)
  })
})
