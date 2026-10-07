import { describe, expect, it } from 'vitest'
import { monitorFrom, physicalToDip } from './geometry'
import { overlayPoint } from './overlay-coords'

describe('overlayPoint', () => {
  it('macOS (sin conversión): resta el origen del display, como siempre', () => {
    expect(overlayPoint({ x: 500, y: 300 }, { x: 0, y: 0 }, null)).toEqual({ x: 500, y: 300 })
    expect(overlayPoint({ x: 500, y: 300 }, { x: 100, y: 50 }, null)).toEqual({ x: 400, y: 250 })
  })

  it('Windows al 150 %: píxeles físicos → DIP y luego origen del display', () => {
    const mons = [monitorFrom({ x: 0, y: 0, width: 2880, height: 1620 }, 1.5, true)]
    const toDip = (p: { x: number; y: number }) => physicalToDip(mons, p) ?? p
    expect(overlayPoint({ x: 1440, y: 810 }, { x: 0, y: 0 }, toDip)).toEqual({ x: 960, y: 540 })
  })

  it('Windows con monitor secundario a la izquierda (origen negativo): el principal sigue en (0,0)', () => {
    const left = monitorFrom({ x: -1920, y: 0, width: 1920, height: 1080 }, 1, false)
    const main = monitorFrom({ x: 0, y: 0, width: 2560, height: 1440 }, 1.75, true)
    const toDip = (p: { x: number; y: number }) => physicalToDip([left, main], p) ?? p
    expect(overlayPoint({ x: 1750, y: 875 }, { x: 0, y: 0 }, toDip)).toEqual({ x: 1000, y: 500 })
  })
})
