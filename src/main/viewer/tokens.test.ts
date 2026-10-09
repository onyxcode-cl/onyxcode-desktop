import { describe, expect, it, beforeEach } from 'vitest'
import { issueToken, resolveToken, revokeActive, revokeToken } from './tokens'

const docA = { path: '/docs/a.pdf', kind: 'pdf' as const }
const docB = { path: '/docs/b.docx', kind: 'docx' as const }

describe('viewer tokens', () => {
  beforeEach(() => {
    // Estado de módulo compartido: partir siempre sin token activo.
    revokeActive()
  })

  it('issueToken devuelve un string hex de 64 caracteres (32 bytes)', () => {
    const token = issueToken(docA)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('resolveToken con el token recién emitido devuelve el payload', () => {
    const token = issueToken(docA)
    expect(resolveToken(token)).toEqual(docA)
  })

  it('resolveToken con un token inventado devuelve null', () => {
    issueToken(docA)
    expect(resolveToken('f'.repeat(64))).toBeNull()
  })

  it('emitir un token nuevo revoca el anterior', () => {
    const old = issueToken(docA)
    const fresh = issueToken(docB)
    expect(resolveToken(old)).toBeNull()
    expect(resolveToken(fresh)).toEqual(docB)
  })

  it('revokeToken con el token activo lo revoca; llamarlo dos veces no falla', () => {
    const token = issueToken(docA)
    revokeToken(token)
    expect(resolveToken(token)).toBeNull()
    expect(() => revokeToken(token)).not.toThrow()
    expect(resolveToken(token)).toBeNull()
  })

  it('revokeToken con un token que no es el activo no hace nada', () => {
    const token = issueToken(docA)
    revokeToken('0'.repeat(64))
    expect(resolveToken(token)).toEqual(docA)
  })

  it('revokeActive revoca lo activo sin necesitar el token; sin nada activo no falla', () => {
    const token = issueToken(docA)
    revokeActive()
    expect(resolveToken(token)).toBeNull()
    expect(() => revokeActive()).not.toThrow()
  })

  it('dos llamadas a issueToken generan tokens distintos', () => {
    const t1 = issueToken(docA)
    const t2 = issueToken(docA)
    expect(t1).not.toBe(t2)
  })
})
