import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearScrollMemory,
  isNearBottom,
  jumpTarget,
  recalledScroll,
  rememberScroll,
  SCROLL_MEMORY_MAX,
  scrollMemorySize
} from './use-stick-to-bottom'

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

describe('memoria de scroll por conversación', () => {
  beforeEach(() => clearScrollMemory())
  it('recuerda posición y si estaba pegada al final', () => {
    rememberScroll('m1', { top: 340, stick: false })
    rememberScroll('m2', { top: 9000, stick: true })
    expect(recalledScroll('m1')).toEqual({ top: 340, stick: false })
    expect(recalledScroll('m2')?.stick).toBe(true)
    expect(recalledScroll('otra')).toBeUndefined()
  })
  it('está acotada: no crece sin límite y descarta la más antigua', () => {
    for (let i = 0; i < SCROLL_MEMORY_MAX + 50; i++) rememberScroll(`k${i}`, { top: i, stick: false })
    expect(scrollMemorySize()).toBe(SCROLL_MEMORY_MAX)
    expect(recalledScroll('k0')).toBeUndefined()
    expect(recalledScroll(`k${SCROLL_MEMORY_MAX + 49}`)).toBeDefined()
  })
  it('actualizar una clave la vuelve la más reciente', () => {
    for (let i = 0; i < SCROLL_MEMORY_MAX; i++) rememberScroll(`k${i}`, { top: i, stick: false })
    rememberScroll('k0', { top: 1, stick: true })
    rememberScroll('nueva', { top: 2, stick: false })
    expect(recalledScroll('k0')).toBeDefined()
    expect(recalledScroll('k1')).toBeUndefined()
  })
})

describe('jumpTarget (celular)', () => {
  it('cerca del final no salta: basta con el smooth', () => {
    expect(jumpTarget(10000, 9000, 800)).toBeNull()
    expect(jumpTarget(10000, 10000 - 800 - 2400, 800)).toBeNull() // justo 3 pantallas
  })
  it('a más de 3 pantallas salta hasta 2 pantallas antes del final', () => {
    expect(jumpTarget(10000, 0, 800)).toBe(8400)
  })
  it('nunca devuelve negativos', () => {
    expect(jumpTarget(2000, 0, 800)).toBeNull()
    expect(jumpTarget(3300, 0, 400)).toBe(2500)
  })
})
