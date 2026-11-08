import { describe, expect, it } from 'vitest'
import { SUGGESTION_REASON_MAX, cleanSuggestionReason, readPermissionSuggestion } from './permission-suggestion'

const md = (s: unknown) => ({ lazunoxSugerencia: s })

describe('readPermissionSuggestion', () => {
  it('lee una sugerencia válida', () => {
    for (const v of ['permitir', 'negar', 'preguntar'] as const) {
      expect(readPermissionSuggestion(md({ sugerencia: v, motivo: 'Es una lectura.' }))).toEqual({ value: v, reason: 'Es una lectura.' })
    }
  })
  it('sin sugerencia o con metadata rara, nada', () => {
    for (const m of [undefined, null, 'x', 3, [], {}, md(null), md('permitir'), md([]), md(7)])
      expect(readPermissionSuggestion(m)).toBeNull()
  })
  it('valor fuera de la lista, con otra capitalización o sin motivo: nada', () => {
    expect(readPermissionSuggestion(md({ sugerencia: 'allow', motivo: 'x' }))).toBeNull()
    expect(readPermissionSuggestion(md({ sugerencia: 'Permitir', motivo: 'x' }))).toBeNull()
    expect(readPermissionSuggestion(md({ sugerencia: 'permitir' }))).toBeNull()
    expect(readPermissionSuggestion(md({ sugerencia: 'permitir', motivo: 5 }))).toBeNull()
    expect(readPermissionSuggestion(md({ sugerencia: 'permitir', motivo: '   ' }))).toBeNull()
  })
  it('ruta protegida: no se muestra', () => {
    expect(readPermissionSuggestion(md({ sugerencia: 'permitir', motivo: 'ok' }), true)).toBeNull()
  })
})

describe('cleanSuggestionReason', () => {
  it('quita etiquetas, enlaces y Markdown', () => {
    const r = cleanSuggestionReason('Mira <a href="http://evil.test">aquí</a> **ya** [clic](https://x.io) y www.mal.com `rm`')
    expect(r).not.toMatch(/[<>*`\[\]()]|https?:|www\./)
    expect(r).toContain('aquí')
  })
  it('quita control, ANSI y marcas de dirección', () => {
    const r = cleanSuggestionReason('a\u0000b\u001b[31mc\u202ed\u2066e\u200bf\nline')
    expect(r).toBe('a bc d e f line')
  })
  it('limita a 200 caracteres', () => {
    expect(cleanSuggestionReason('a'.repeat(500)).length).toBe(SUGGESTION_REASON_MAX)
  })
  it('no texto = vacío', () => {
    expect(cleanSuggestionReason(undefined)).toBe('')
  })
})
