import { describe, expect, it } from 'vitest'
import { sandboxProviderNotice } from './sandbox-providers'
import { NO_AI_ERROR, friendlyError, redactSecrets } from './ai-errors'

const CAPTURE =
  'ProviderModelNotFoundError: Model not found: opencode-go/deepseek-v4.1-flash. Did you mean: deepseek-v4.1-flash?\n    at <anonymous> (/$bunfs/root/chunk.js:1:1)'

describe('friendlyError', () => {
  it('la cadena exacta de la captura es model-not-found con el id del modelo', () => {
    const f = friendlyError({ name: 'UnknownError', data: { message: CAPTURE } })
    expect(f.kind).toBe('model-not-found')
    expect(f.title).toBe('El modelo elegido no está disponible')
    expect(f.message).toBe('“opencode-go/deepseek-v4.1-flash” no pertenece a ninguna IA conectada. Elige otro modelo o conecta una IA.')
    expect(f.action).toBe('connect')
    expect(f.detail).toContain('at <anonymous>')
    expect(f.message).not.toContain('at <anonymous>')
  })

  it('ProviderAuthError usa el nombre del proveedor', () => {
    const f = friendlyError(
      { name: 'ProviderAuthError', data: { providerID: 'acme', message: 'x' } },
      { providerNames: { acme: 'Acme IA' } }
    )
    expect(f.kind).toBe('auth')
    expect(f.message).toContain('de Acme IA')
    expect(f.action).toBe('connect')
  })

  it.each([401, 403])('APIError %i es auth', (statusCode) => {
    const f = friendlyError({ name: 'APIError', data: { message: 'nope', statusCode, isRetryable: false } })
    expect(f.kind).toBe('auth')
    expect(f.title).toBe('La IA rechazó la conexión')
    expect(f.detail).toContain(`statusCode: ${statusCode}`)
  })

  it.each([429, 402])('APIError %i es cuota', (statusCode) => {
    expect(friendlyError({ name: 'APIError', data: { message: 'x', statusCode, isRetryable: true } }).kind).toBe('quota')
  })

  it('texto de cuota y de clave inválida', () => {
    expect(friendlyError('Rate limit exceeded').kind).toBe('quota')
    expect(friendlyError('Invalid API key provided').kind).toBe('auth')
  })

  it('ECONNREFUSED es de red', () => {
    const f = friendlyError(new Error('connect ECONNREFUSED 127.0.0.1:443'))
    expect(f.kind).toBe('network')
    expect(f.title).toBe('Sin conexión')
  })

  it('ContextOverflowError', () => {
    expect(friendlyError({ name: 'ContextOverflowError', data: { message: 'too big' } }).kind).toBe('context')
  })

  it('el aviso de sandbox pasa intacto y sin detalle', () => {
    const f = friendlyError(sandboxProviderNotice())
    expect(f.kind).toBe('unknown')
    expect(f.message).toBe(sandboxProviderNotice())
    expect(f.detail).toBeNull()
  })

  it('un error desconocido con pila se oculta tras un mensaje genérico', () => {
    const f = friendlyError({ name: 'UnknownError', data: { message: 'TypeError: boom\n    at x (/a.js:1:1)' } })
    expect(f.title).toBe('Algo salió mal')
    expect(f.message).toBe('OpenCode devolvió un error inesperado.')
    expect(f.detail).toContain('boom')
  })

  it('redacta claves y no incluye cabeceras', () => {
    const f = friendlyError({
      name: 'APIError',
      data: {
        message: 'bad sk-abcdefghijkl1234',
        statusCode: 500,
        isRetryable: false,
        responseHeaders: { authorization: 'Bearer zzzz' },
        responseBody: 'token_ABCDEFGHIJ99'
      }
    })
    expect(f.detail).not.toContain('sk-abcdefghijkl1234')
    expect(f.detail).not.toContain('token_ABCDEFGHIJ99')
    expect(f.detail).not.toContain('Bearer')
    expect(redactSecrets('mi key-12345678 fin')).toBe('mi … fin')
  })

  it('redactSecrets también oculta los patrones de Diagnóstico', () => {
    for (const [text, secret] of [
      ['Bearer abcDEF123456xyz', 'abcDEF123456xyz'],
      ['api_key=Zm9vYmFyMTIz', 'Zm9vYmFyMTIz'],
      ['https://x.example/?key=SECRETVALUE99', 'SECRETVALUE99'],
      ['clave AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q', 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'],
      ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789']
    ])
      expect(redactSecrets(text)).not.toContain(secret)
    expect(redactSecrets('Modelo fake-model no encontrado')).toBe('Modelo fake-model no encontrado')
  })

  it('recorta el detalle a 2000 caracteres', () => {
    const f = friendlyError({
      name: 'APIError',
      data: { message: 'x', statusCode: 500, isRetryable: false, responseBody: 'a'.repeat(5000) }
    })
    expect(f.detail!.length).toBe(2000)
  })

  it('NO_AI_ERROR', () => {
    const f = friendlyError(NO_AI_ERROR)
    expect(f.kind).toBe('no-ai')
    expect(f.action).toBe('connect')
    expect(f.title).toBe('Aún no conectaste ninguna IA')
  })
})
