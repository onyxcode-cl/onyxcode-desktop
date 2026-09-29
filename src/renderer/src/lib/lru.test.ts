import { afterEach, describe, expect, it, vi } from 'vitest'
import { lruMax } from './lru'

const original = globalThis.localStorage
afterEach(() => {
  vi.stubGlobal('localStorage', original)
  localStorage.clear()
})

describe('lruMax', () => {
  it('sin override devuelve el default', () => {
    expect(lruMax(40)).toBe(40)
  })
  it('un entero ≥ 1 en onyx.lru.max lo sobrescribe', () => {
    localStorage.setItem('onyx.lru.max', '2')
    expect(lruMax(40)).toBe(2)
  })
  it('valores inválidos (0, negativo, texto) caen al default', () => {
    for (const v of ['0', '-3', 'x', '']) {
      localStorage.setItem('onyx.lru.max', v)
      expect(lruMax(40)).toBe(40)
    }
  })
  it('si localStorage lanza, usa el default', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('denied')
      }
    })
    expect(lruMax(20)).toBe(20)
  })
})
