import { describe, expect, it } from 'vitest'
import { tabTarget } from './modal-focus'

describe('tabTarget (trampa de foco de los diálogos)', () => {
  it('sin controles no hace nada', () => {
    expect(tabTarget(0, -1, false)).toBeNull()
  })
  it('Tab en el último vuelve al primero; Mayús+Tab en el primero va al último', () => {
    expect(tabTarget(3, 2, false)).toBe(0)
    expect(tabTarget(3, 0, true)).toBe(2)
  })
  it('en medio lo resuelve el navegador', () => {
    expect(tabTarget(3, 1, false)).toBeNull()
    expect(tabTarget(3, 1, true)).toBeNull()
  })
  it('con el foco fuera de los controles, entra por el primero (Tab) o el último (Mayús+Tab)', () => {
    expect(tabTarget(3, -1, false)).toBe(0)
    expect(tabTarget(3, -1, true)).toBe(2)
  })
  it('con un solo control, Tab y Mayús+Tab se quedan en él', () => {
    expect(tabTarget(1, 0, false)).toBe(0)
    expect(tabTarget(1, 0, true)).toBe(0)
  })
})
