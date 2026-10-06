import { describe, expect, it } from 'vitest'
import { clampBounds } from './window-bounds'

const DESIRED = { width: 1280, height: 820, minWidth: 820, minHeight: 560 }
// Área útil física (barra de tareas de 48 px a 100 %, escalada con la pantalla).
const work = (pw: number, ph: number, scale: number) => ({
  x: 0,
  y: 0,
  width: Math.floor(pw / scale),
  height: Math.floor((ph - 48 * scale) / scale)
})

describe.each([
  ['1080p', 1920, 1080],
  ['1440p', 2560, 1440]
])('clampBounds en %s', (_n, pw, ph) => {
  it.each([1, 1.25, 1.5, 2])('escala %s: nunca excede el área útil y respeta el 90 %%', (scale) => {
    const wa = work(pw, ph, scale)
    const r = clampBounds(wa, scale, DESIRED)
    expect(r.minWidth).toBeLessThanOrEqual(wa.width)
    expect(r.minHeight).toBeLessThanOrEqual(wa.height)
    expect(r.minWidth).toBe(Math.min(820, wa.width))
    expect(r.minHeight).toBe(Math.min(560, wa.height))
    expect(r.width).toBeLessThanOrEqual(Math.max(r.minWidth, wa.width * 0.9))
    expect(r.height).toBeLessThanOrEqual(Math.max(r.minHeight, wa.height * 0.9))
    expect(r.width).toBeGreaterThanOrEqual(r.minWidth)
    expect(r.height).toBeGreaterThanOrEqual(r.minHeight)
    expect(r.x).toBeGreaterThanOrEqual(wa.x)
    expect(r.y).toBeGreaterThanOrEqual(wa.y)
    expect(r.x + r.width).toBeLessThanOrEqual(wa.x + wa.width)
    expect(r.y + r.height).toBeLessThanOrEqual(wa.y + wa.height)
  })
})

describe('clampBounds casos concretos', () => {
  it('1080p a 200 %: el mínimo baja al área útil y la ventana cabe', () => {
    const wa = work(1920, 1080, 2) // 960×492
    expect(wa).toEqual({ x: 0, y: 0, width: 960, height: 492 })
    const r = clampBounds(wa, 2, DESIRED)
    expect(r.minHeight).toBe(492)
    expect(r.height).toBe(492)
    expect(r.width).toBe(864)
  })
  it('1440p a 100 %: no cambia nada (cabe el tamaño deseado)', () => {
    const r = clampBounds(work(2560, 1440, 1), 1, DESIRED)
    expect(r).toMatchObject(DESIRED)
  })
  it('1080p a 100 %: el alto se limita al 90 % del área útil', () => {
    const wa = work(1920, 1080, 1) // 1920×1032
    expect(clampBounds(wa, 1, DESIRED).height).toBe(820)
    const small = clampBounds({ x: 0, y: 0, width: 1366, height: 728 }, 1, DESIRED)
    expect(small.height).toBe(655)
    expect(small.minHeight).toBe(560)
  })
  it('respeta el origen del área útil (segundo monitor) y centra', () => {
    const r = clampBounds({ x: 1920, y: 0, width: 1920, height: 1032 }, 1, DESIRED)
    expect(r.x).toBe(1920 + (1920 - 1280) / 2)
    expect(r.y).toBe((1032 - 820) / 2)
  })
  it('escala inválida se trata como 1', () => {
    expect(clampBounds({ x: 0, y: 0, width: 1920, height: 1000 }, NaN, DESIRED).width).toBe(1280)
  })
})
