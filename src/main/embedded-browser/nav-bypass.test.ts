import { describe, expect, it } from 'vitest'
import { NavBypass } from './nav-bypass'

describe('NavBypass (exención por URL exacta y de un solo uso)', () => {
  it('solo la URL autorizada pasa; otra URL de la misma pestaña (redirección, window.open) NO', () => {
    const b = new NavBypass()
    b.allow('t1', 'https://ok.com')
    expect(b.take('t1', 'http://127.0.0.1:4173/')).toBe(false)
    expect(b.take('t1', 'https://ok.com/')).toBe(true) // normalizada
  })
  it('un solo uso: la segunda navegación a la misma URL vuelve a pasar por la puerta', () => {
    const b = new NavBypass()
    b.allow('t1', 'https://ok.com/')
    expect(b.take('t1', 'https://ok.com/')).toBe(true)
    expect(b.take('t1', 'https://ok.com/')).toBe(false)
  })
  it('por pestaña y con caducidad', () => {
    let t = 0
    const b = new NavBypass(() => t)
    b.allow('t1', 'https://ok.com/', 2000)
    expect(b.take('t2', 'https://ok.com/')).toBe(false)
    t = 2001
    expect(b.take('t1', 'https://ok.com/')).toBe(false)
  })
  it('revoke y clearTab', () => {
    const b = new NavBypass()
    b.allow('t1', 'https://a.com/')
    b.allow('t1', 'https://b.com/')
    b.revoke('t1', 'https://a.com/')
    expect(b.take('t1', 'https://a.com/')).toBe(false)
    b.clearTab('t1')
    expect(b.take('t1', 'https://b.com/')).toBe(false)
  })
})
