import { describe, expect, it, beforeEach } from 'vitest'
import { issueCaptureToken, issueToken, resolveCaptureToken, resolveToken, revokeActive, revokeCaptureToken, revokeToken } from './tokens'

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

describe('ranura de captura (render oculto de la IA)', () => {
  beforeEach(() => revokeActive())

  it('emitir o revocar uno de captura NO toca el token del panel, ni al revés', () => {
    const panel = issueToken(docA)
    const cap = issueCaptureToken(docB)
    expect(cap).toMatch(/^[0-9a-f]{64}$/)
    expect(resolveToken(panel)).toEqual(docA)
    expect(resolveToken(cap)).toEqual(docB)
    revokeCaptureToken(cap)
    expect(resolveToken(cap)).toBeNull()
    expect(resolveToken(panel)).toEqual(docA)
    const cap2 = issueCaptureToken(docB)
    revokeActive()
    expect(resolveToken(panel)).toBeNull()
    expect(resolveToken(cap2)).toEqual(docB)
    revokeCaptureToken(cap2)
  })

  it('emitir un token de panel nuevo no revoca el de captura en curso (el panel abierto no se rompe con un render oculto)', () => {
    const cap = issueCaptureToken(docB)
    const panel = issueToken(docA)
    issueToken(docA)
    expect(resolveToken(cap)).toEqual(docB)
    expect(resolveToken(panel)).toBeNull()
    revokeCaptureToken(cap)
  })

  it('vence solo a los 30 s y revocarlo es idempotente', () => {
    let t = 1000
    const cap = issueCaptureToken(docB, () => t)
    t += 29_000
    expect(resolveCaptureToken(cap, () => t)).toEqual(docB)
    t += 2_000
    expect(resolveCaptureToken(cap, () => t)).toBeNull()
    expect(() => revokeCaptureToken(cap)).not.toThrow()
    expect(resolveCaptureToken('f'.repeat(64))).toBeNull()
  })

  it('el token de captura es distinto del del panel y no se puede adivinar con el del panel', () => {
    const panel = issueToken(docA)
    expect(resolveCaptureToken(panel)).toBeNull()
  })
})
