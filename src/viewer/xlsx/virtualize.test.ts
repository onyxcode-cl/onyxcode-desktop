import { describe, expect, it } from 'vitest'
import { cumulativeOffsets, visibleRowRange } from './virtualize'

describe('cumulativeOffsets', () => {
  it('da el prefijo acumulado, con un elemento más que la entrada (el total al final)', () => {
    expect(cumulativeOffsets([20, 20, 30])).toEqual([0, 20, 40, 70])
  })
  it('sin filas: [0]', () => {
    expect(cumulativeOffsets([])).toEqual([0])
  })
})

describe('visibleRowRange', () => {
  const uniform = Array.from({ length: 1000 }, () => 20) // 1000 filas de 20px = 20000px

  it('arriba del todo: empieza en 0 (el overscan no lo manda bajo cero)', () => {
    const r = visibleRowRange(0, 100, uniform, 4)
    expect(r.start).toBe(0)
    expect(r.offsetY).toBe(0)
    expect(r.totalHeight).toBe(20000)
    // 100px de viewport / 20px por fila = 5 filas visibles + 4 de overscan abajo
    expect(r.end).toBe(9)
  })

  it('a la mitad del scroll: el rango se corre y el overscan se aplica en ambos lados', () => {
    const r = visibleRowRange(2000, 100, uniform, 4) // fila 100 es la primera visible
    expect(r.start).toBe(96)
    expect(r.end).toBe(104 + 1 + 4) // 100..104 visibles + 4 de overscan
    expect(r.offsetY).toBe(96 * 20)
  })

  it('al fondo del todo: el overscan no se pasa del total de filas', () => {
    const r = visibleRowRange(20000, 100, uniform, 4)
    expect(r.end).toBe(1000)
    expect(r.start).toBeLessThanOrEqual(999)
  })

  it('con 100.000 filas, sigue siendo instantáneo (búsqueda binaria, no lineal)', () => {
    const big = Array.from({ length: 100_000 }, () => 20)
    const start = performance.now()
    const r = visibleRowRange(1_500_000, 600, big, 4)
    expect(performance.now() - start).toBeLessThan(20)
    expect(r.end - r.start).toBeLessThan(60) // una ventana chica, no las 100k filas
  })

  it('sin filas: rango vacío, sin lanzar', () => {
    expect(visibleRowRange(0, 100, [], 4)).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 })
  })

  it('alturas variables: el offset de cada fila respeta su propia altura', () => {
    const rows = [10, 50, 10, 10, 50]
    const r = visibleRowRange(60, 10, rows, 0) // y=60 cae justo al empezar la fila 2 (10+50)
    expect(r.start).toBe(2)
  })

  it('scrollTop o alto negativos no rompen nada (se tratan como 0)', () => {
    const r = visibleRowRange(-50, -10, uniform, 2)
    expect(r.start).toBe(0)
    expect(r.end).toBeGreaterThan(0)
  })
})
