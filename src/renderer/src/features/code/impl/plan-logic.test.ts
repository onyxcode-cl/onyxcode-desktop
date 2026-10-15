import { describe, expect, it } from 'vitest'
import { activeKey, derivePlan, formatElapsed } from './plan-logic'

const td = (content: string, status: string) => ({ content, status }) as never

describe('derivePlan', () => {
  it('sin pasos no hay plan', () => {
    expect(derivePlan(undefined)).toBeNull()
    expect(derivePlan([])).toBeNull()
  })
  it('cuenta hechos y marca el paso en curso', () => {
    const v = derivePlan([td('a', 'completed'), td('b', 'completed'), td('c', 'in_progress'), td('d', 'pending'), td('e', 'pending')])!
    expect([v.done, v.total, v.activeIndex, v.complete]).toEqual([2, 5, 2, false])
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'done', 'active', 'pending', 'pending'])
  })
  it('cancelado cuenta como hecho y todo hecho marca complete', () => {
    const v = derivePlan([td('a', 'completed'), td('b', 'cancelled')])!
    expect([v.done, v.complete, v.activeIndex]).toEqual([2, true, -1])
    expect(activeKey(v)).toBeNull()
  })
  it('la clave del paso en curso cambia con el paso', () => {
    const a = derivePlan([td('a', 'in_progress'), td('b', 'pending')])
    const b = derivePlan([td('a', 'completed'), td('b', 'in_progress')])
    expect(activeKey(a)).not.toEqual(activeKey(b))
  })
})

describe('formatElapsed', () => {
  it('formatea m:ss y h:mm:ss', () => {
    expect(formatElapsed(14_000)).toBe('0:14')
    expect(formatElapsed(65_000)).toBe('1:05')
    expect(formatElapsed(3_723_000)).toBe('1:02:03')
    expect(formatElapsed(-5)).toBe('0:00')
  })
})
