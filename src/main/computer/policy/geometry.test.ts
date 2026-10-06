import { describe, expect, it } from 'vitest'
import {
  type Monitor,
  type Rect,
  type WinInfo,
  captureSize,
  checkOnPrimary,
  dipToPhysical,
  masksToCapturePx,
  monitorFrom,
  physicalToDip,
  physicalToPx,
  planMasks,
  pxToPhysical,
  rectPhysicalToDip,
  subtractRect,
  windowsChanged
} from './geometry'

const R = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height })
const area = (rs: Rect[]): number => rs.reduce((a, r) => a + r.width * r.height, 0)

describe('captureSize', () => {
  it.each([
    [1920, 1080, 1366, 768, 1920 / 1366],
    [2560, 1440, 1366, 768, 2560 / 1366],
    [1280, 720, 1280, 720, 1],
    [1080, 1920, 768, 1366, 1080 / 768]
  ])('%dx%d', (w, h, cw, ch, ratio) => {
    const c = captureSize(w, h)!
    expect([c.width, c.height]).toEqual([cw, ch])
    expect(c.ratio).toBeCloseTo(ratio, 6)
  })
  it('entradas no válidas', () => {
    expect(captureSize(0, 10)).toBeNull()
    expect(captureSize(NaN, 10)).toBeNull()
  })
})

describe.each([1, 1.5, 1.75])('escalado %s: px ↔ físico ↔ DIP', (scale) => {
  const physW = Math.round(1920 * scale)
  const physH = Math.round(1080 * scale)
  const main = monitorFrom(R(0, 0, physW, physH), scale, true)
  const cap = captureSize(physW, physH)!
  it('ida y vuelta px → físico → px con error ≤ 1 px de captura', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
      { x: cap.width - 1, y: cap.height - 1 },
      { x: 683, y: 384 }
    ]) {
      const phys = pxToPhysical(p, cap.ratio, { x: 0, y: 0 })
      const back = physicalToPx(phys, cap.ratio, { x: 0, y: 0 })
      expect(Math.abs(back.x - p.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.y - p.y)).toBeLessThanOrEqual(1)
    }
  })
  it('físico → DIP → físico es estable (±1 px)', () => {
    for (const p of [
      { x: 0, y: 0 },
      { x: 333, y: 777 },
      { x: physW - 1, y: physH - 1 }
    ]) {
      const dip = physicalToDip([main], p)!
      expect(dip.x).toBeCloseTo(p.x / scale, 6)
      const back = dipToPhysical([main], dip)!
      expect(Math.abs(back.x - p.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(back.y - p.y)).toBeLessThanOrEqual(1)
    }
  })
  it('un punto fuera de todo monitor no tiene DIP', () => {
    expect(physicalToDip([main], { x: physW, y: 0 })).toBeNull()
    expect(dipToPhysical([main], { x: -1, y: 0 })).toBeNull()
  })
  it('el rectángulo físico escala al DIP', () => {
    const r = rectPhysicalToDip([main], R(scale * 100, scale * 40, scale * 200, scale * 80))!
    expect(r.x).toBeCloseTo(100)
    expect(r.width).toBeCloseTo(200)
    expect(r.height).toBeCloseTo(80)
  })
})

describe('monitor secundario a la izquierda (origen negativo) con escalados distintos', () => {
  // Principal 150 % 2880x1620 físicos (1920x1080 DIP); secundario 100 % 1920x1080 a su izquierda.
  const main: Monitor = { main: true, physical: R(0, 0, 2880, 1620), dip: R(0, 0, 1920, 1080), scale: 1.5 }
  const left: Monitor = { main: false, physical: R(-1920, 0, 1920, 1080), dip: R(-1920, 0, 1920, 1080), scale: 1 }
  const mons = [main, left]
  it('físico negativo → DIP en el monitor secundario', () => {
    expect(physicalToDip(mons, { x: -1920, y: 0 })).toEqual({ x: -1920, y: 0 })
    expect(physicalToDip(mons, { x: -1, y: 1079 })).toEqual({ x: -1, y: 1079 })
  })
  it('principal: 1.5x', () => {
    expect(physicalToDip(mons, { x: 1500, y: 750 })).toEqual({ x: 1000, y: 500 })
    expect(dipToPhysical(mons, { x: 1000, y: 500 })).toEqual({ x: 1500, y: 750 })
  })
  it('captura con origen negativo (si se capturara el secundario)', () => {
    const p = pxToPhysical({ x: 10, y: 20 }, 1.4, { x: -1920, y: 0 })
    expect(p).toEqual({ x: -1906, y: 28 })
    expect(physicalToPx(p, 1.4, { x: -1920, y: 0 })).toEqual({ x: 10, y: 20 })
  })
  it('v1: solo el principal; fuera de él se rechaza con motivo claro', () => {
    expect(checkOnPrimary(mons, { x: 5, y: 5 }).ok).toBe(true)
    const v = checkOnPrimary(mons, { x: -5, y: 5 })
    expect(!v.ok && v.reason).toMatch(/principal/)
    expect(checkOnPrimary(mons, { x: 2880, y: 0 }).ok).toBe(false)
    expect(checkOnPrimary([left], { x: 0, y: 0 }).ok).toBe(false)
    expect(checkOnPrimary(mons, { x: NaN, y: 0 }).ok).toBe(false)
  })
})

describe('subtractRect', () => {
  it('sin solape devuelve el original; tapado total devuelve nada', () => {
    expect(subtractRect(R(0, 0, 10, 10), R(20, 20, 5, 5))).toEqual([R(0, 0, 10, 10)])
    expect(subtractRect(R(2, 2, 4, 4), R(0, 0, 10, 10))).toEqual([])
  })
  it('conserva el área: |a| - |a ∩ b|', () => {
    expect(area(subtractRect(R(0, 0, 10, 10), R(3, 3, 4, 4)))).toBe(100 - 16)
    expect(area(subtractRect(R(0, 0, 10, 10), R(-5, -5, 10, 10)))).toBe(100 - 25)
    expect(area(subtractRect(R(0, 0, 10, 10), R(5, 0, 20, 10)))).toBe(50)
  })
})

describe('planMasks: orden Z (de delante hacia atrás)', () => {
  const bounds = R(0, 0, 1000, 800)
  const W = (id: string, granted: boolean, r: Rect): WinInfo => ({ id, granted, rect: r })

  it('solo concedidas: sin máscaras', () => {
    expect(planMasks({ windows: [W('a', true, R(0, 0, 500, 500))], bounds, canMask: false })).toEqual({ ok: true, masks: [] })
  })
  it('una no concedida visible se tapa entera', () => {
    expect(planMasks({ windows: [W('b', false, R(100, 100, 200, 200))], bounds, canMask: true })).toEqual({
      ok: true,
      masks: [R(100, 100, 200, 200)]
    })
  })
  it('una concedida ENCIMA de una no concedida no se tapa (la máscara la rodea)', () => {
    const plan = planMasks({ windows: [W('g', true, R(150, 150, 100, 100)), W('n', false, R(100, 100, 200, 200))], bounds, canMask: true })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(area(plan.masks)).toBe(200 * 200 - 100 * 100)
    for (const m of plan.masks) expect(subtractRect(m, R(150, 150, 100, 100))).toEqual([m])
  })
  it('una no concedida ENCIMA de una concedida se tapa entera (aunque tape a la concedida)', () => {
    const plan = planMasks({ windows: [W('n', false, R(100, 100, 200, 200)), W('g', true, R(150, 150, 100, 100))], bounds, canMask: true })
    expect(plan).toEqual({ ok: true, masks: [R(100, 100, 200, 200)] })
  })
  it('concedida totalmente encima: no queda nada que tapar', () => {
    const plan = planMasks({ windows: [W('g', true, R(0, 0, 400, 400)), W('n', false, R(100, 100, 200, 200))], bounds, canMask: false })
    expect(plan).toEqual({ ok: true, masks: [] })
  })
  it('dos concedidas encima, una no concedida debajo: el área sobrante es exacta', () => {
    const plan = planMasks({
      windows: [W('g1', true, R(0, 0, 150, 300)), W('g2', true, R(250, 0, 150, 300)), W('n', false, R(100, 100, 200, 100))],
      bounds,
      canMask: true
    })
    expect(plan.ok && area(plan.masks)).toBe(200 * 100 - 50 * 100 - 50 * 100)
  })
  it('se recorta a la zona capturada y se ignoran las ventanas fuera', () => {
    const plan = planMasks({ windows: [W('n', false, R(900, 700, 300, 300)), W('f', false, R(2000, 0, 50, 50))], bounds, canMask: true })
    expect(plan).toEqual({ ok: true, masks: [R(900, 700, 100, 100)] })
  })
  it('FALLA CERRADO: enumeración fallida', () => {
    expect(planMasks({ windows: null, bounds, canMask: true }).ok).toBe(false)
  })
  it('FALLA CERRADO: hay que tapar y no se puede enmascarar', () => {
    const plan = planMasks({ windows: [W('n', false, R(0, 0, 10, 10))], bounds, canMask: false })
    expect(!plan.ok && plan.reason).toMatch(/falla cerrado/)
  })
  it('FALLA CERRADO: rectángulo no válido en una no concedida; zona de captura no válida', () => {
    expect(planMasks({ windows: [W('n', false, R(NaN, 0, 10, 10))], bounds, canMask: true }).ok).toBe(false)
    expect(planMasks({ windows: [], bounds: R(0, 0, 0, 0), canMask: true }).ok).toBe(false)
  })
  it('una concedida con rectángulo inválido no se usa para descubrir a otras', () => {
    const plan = planMasks({ windows: [W('g', true, R(NaN, 0, 10, 10)), W('n', false, R(0, 0, 10, 10))], bounds, canMask: true })
    expect(plan).toEqual({ ok: true, masks: [R(0, 0, 10, 10)] })
  })
})

describe('windowsChanged (enumerar antes y después de capturar)', () => {
  const a: WinInfo[] = [{ id: '1', granted: true, rect: R(0, 0, 10, 10) }]
  it('iguales / distintas', () => {
    expect(windowsChanged(a, [{ ...a[0], rect: R(0, 0, 10, 10) }])).toBe(false)
    expect(windowsChanged(a, [{ ...a[0], rect: R(1, 0, 10, 10) }])).toBe(true)
    expect(windowsChanged(a, [{ ...a[0], granted: false }])).toBe(true)
    expect(windowsChanged(a, [])).toBe(true)
    expect(windowsChanged(a, [{ ...a[0], id: '2' }])).toBe(true)
  })
})

describe('masksToCapturePx', () => {
  it('redondea hacia fuera y recorta a la imagen', () => {
    const out = masksToCapturePx([R(10, 10, 21, 21), R(2800, 1500, 200, 200)], 1.5, { x: 0, y: 0 }, { width: 1920, height: 1080 })
    expect(out[0]).toEqual({ x: 6, y: 6, width: 15, height: 15 })
    expect(out[1]).toEqual({ x: 1866, y: 1000, width: 54, height: 80 })
  })
  it('la máscara cubre siempre el rectángulo físico original', () => {
    const ratio = 1920 / 1366
    for (const m of [R(1, 1, 3, 3), R(333, 777, 41, 59), R(1000, 500, 1, 1)]) {
      const [o] = masksToCapturePx([m], ratio, { x: 0, y: 0 }, { width: 1366, height: 768 })
      expect(o.x * ratio).toBeLessThanOrEqual(m.x)
      expect(o.y * ratio).toBeLessThanOrEqual(m.y)
      expect((o.x + o.width) * ratio).toBeGreaterThanOrEqual(m.x + m.width)
      expect((o.y + o.height) * ratio).toBeGreaterThanOrEqual(m.y + m.height)
    }
  })
  it('origen negativo', () => {
    const [o] = masksToCapturePx([R(-1900, 10, 100, 100)], 1, { x: -1920, y: 0 }, { width: 1920, height: 1080 })
    expect(o).toEqual({ x: 20, y: 10, width: 100, height: 100 })
  })
})
