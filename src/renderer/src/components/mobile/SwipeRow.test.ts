import { describe, expect, it } from 'vitest'
import { SWIPE_ACTION_W, swipeAxis, swipeDecision } from './SwipeRow'

const W = SWIPE_ACTION_W * 2

describe('swipeAxis', () => {
  it('espera hasta mover 8 px', () => {
    expect(swipeAxis(3, 2)).toBe('pending')
  })
  it('lo vertical se suelta para que haga scroll la lista', () => {
    expect(swipeAxis(4, 12)).toBe('vertical')
  })
  it('lo horizontal sigue al dedo', () => {
    expect(swipeAxis(-14, 3)).toBe('horizontal')
  })
})

describe('swipeDecision', () => {
  it('cerrada: más del 40 % abre, menos no', () => {
    expect(swipeDecision(-W * 0.5, -W * 0.5, 600, W, false)).toBe('open')
    expect(swipeDecision(-W * 0.3, -W * 0.3, 600, W, false)).toBe('closed')
  })
  it('un roce rápido a la izquierda abre aunque sea corto', () => {
    expect(swipeDecision(-20, -20, 30, W, false)).toBe('open')
  })
  it('abierta: un roce rápido a la derecha cierra', () => {
    expect(swipeDecision(-W + 20, 20, 30, W, true)).toBe('closed')
  })
  it('un deslizamiento larguísimo solo abre: nunca borra', () => {
    for (const dx of [-W, -W * 3, -2000]) {
      expect(['open', 'closed']).toContain(swipeDecision(Math.max(dx, -W), dx, 80, W, false))
    }
    expect(swipeDecision(-W, -2000, 80, W, false)).toBe('open')
  })
})
