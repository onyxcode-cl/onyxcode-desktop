import { describe, expect, it } from 'vitest'
import { isNearBottom } from './use-stick-to-bottom'

describe('isNearBottom', () => {
  it('pegado al final y a menos de 80 px cuenta como al final', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 500, clientHeight: 500 })).toBe(true)
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 421, clientHeight: 500 })).toBe(true)
  })
  it('a 80 px o más del final aparece «Ir al final»', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 420, clientHeight: 500 })).toBe(false)
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 0, clientHeight: 500 })).toBe(false)
  })
})
