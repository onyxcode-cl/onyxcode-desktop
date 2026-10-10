import { describe, expect, it } from 'vitest'
import { dayBucket } from './day-bucket'

describe('dayBucket', () => {
  const now = new Date(2026, 9, 10, 15, 0, 0).getTime() // sábado 10 oct 2026, 15:00
  const at = (d: number, h = 12): number => new Date(2026, 9, d, h, 0, 0).getTime()
  it('hoy, ayer, esta semana y antes', () => {
    expect(dayBucket(at(10, 1), now)).toBe('today')
    expect(dayBucket(at(9), now)).toBe('yesterday')
    expect(dayBucket(at(5), now)).toBe('week')
    expect(dayBucket(at(4), now)).toBe('week')
    expect(dayBucket(at(3), now)).toBe('older')
  })
})
