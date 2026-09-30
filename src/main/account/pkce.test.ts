import { describe, expect, it } from 'vitest'
import { base64url, challengeFor, createPkce, createState, createVerifier, safeEqual } from './pkce'

describe('pkce', () => {
  it('vector del RFC 7636 (apéndice B)', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('el verifier del RFC sale de los 32 octetos del apéndice B', () => {
    const octets = Buffer.from([
      116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83,
      132, 141, 121
    ])
    expect(createVerifier(octets)).toBe('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')
  })

  it('el verifier cumple 43-128 caracteres del alfabeto permitido y no se repite', () => {
    const a = createVerifier()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createVerifier()).not.toBe(a)
  })

  it('createPkce: S256 y challenge coherente', () => {
    const p = createPkce()
    expect(p.method).toBe('S256')
    expect(p.challenge).toBe(challengeFor(p.verifier))
    expect(p.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('state: 256 bits, base64url, distinto cada vez', () => {
    const s = createState()
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createState()).not.toBe(s)
  })

  it('base64url no deja +, / ni =', () => {
    expect(base64url(Buffer.from([0xfb, 0xff, 0xfe]))).toBe('-__-')
    expect(base64url(Buffer.from('a'))).toBe('YQ')
  })

  it('safeEqual', () => {
    expect(safeEqual('abc', 'abc')).toBe(true)
    expect(safeEqual('abc', 'abd')).toBe(false)
    expect(safeEqual('abc', 'abcd')).toBe(false)
  })
})
