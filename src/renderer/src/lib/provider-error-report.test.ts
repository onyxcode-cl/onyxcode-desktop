import { beforeEach, describe, expect, it, vi } from 'vitest'

const sent: string[] = []
vi.mock('./report-problems', () => ({ reportProblem: (m: string) => sent.push(m) }))

import { providerErrorSummary, reportProviderError } from './provider-error-report'

const ev = (error: unknown): never => ({ type: 'session.error', properties: { sessionID: 's1', error } }) as never
const apiError = {
  name: 'APIError',
  data: { message: 'secreto sk-abcdefghijklmnopqrstuvwxyz', statusCode: 401, providerID: 'openai', responseBody: 'cuerpo privado' }
}

beforeEach(() => {
  sent.length = 0
})

describe('error de proveedor de una sesión', () => {
  it('resume solo proveedor, estado y clase (sin mensaje ni cuerpo)', () => {
    const s = providerErrorSummary(ev(apiError))!
    expect(s).toContain('proveedor=openai')
    expect(s).toContain('estado=401')
    expect(s).toContain('clase=auth')
    expect(s).not.toContain('secreto')
    expect(s).not.toContain('cuerpo privado')
  })
  it('ignora otros eventos y el aborto del usuario', () => {
    expect(providerErrorSummary({ type: 'session.idle', properties: { sessionID: 's' } } as never)).toBeNull()
    expect(providerErrorSummary(ev({ name: 'MessageAbortedError', data: {} }))).toBeNull()
  })
  it('no repite lo mismo en 10 s', () => {
    reportProviderError(ev(apiError), 1_000)
    reportProviderError(ev(apiError), 5_000)
    expect(sent).toHaveLength(1)
    reportProviderError(ev(apiError), 20_000)
    expect(sent).toHaveLength(2)
  })
})
