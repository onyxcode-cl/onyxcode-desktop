import { describe, expect, it } from 'vitest'
import { nextSessionsLimit, SESSIONS_ALL, SESSIONS_PAGE, sessionsMayHaveMore } from './session-paging'

describe('paginación de sesiones', () => {
  it('avanza de 200 en 200 y «todas» salta al tope', () => {
    expect(nextSessionsLimit(SESSIONS_PAGE)).toBe(400)
    expect(nextSessionsLimit(SESSIONS_PAGE, true)).toBe(SESSIONS_ALL)
    expect(nextSessionsLimit(SESSIONS_ALL)).toBe(SESSIONS_ALL)
  })
  it('hay más solo si la lista llegó llena', () => {
    expect(sessionsMayHaveMore(200, 200)).toBe(true)
    expect(sessionsMayHaveMore(199, 200)).toBe(false)
    expect(sessionsMayHaveMore(10_000, SESSIONS_ALL)).toBe(false)
  })
})
