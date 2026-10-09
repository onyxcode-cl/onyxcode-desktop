/** Cuenta de permisos/preguntas que esperan al usuario (decide si main restaura la ventana principal minimizada por el control). */
import { describe, expect, it } from 'vitest'
import { pendingPromptCount } from './store'

const perm = (id: string): never => ({ id }) as never

describe('pendingPromptCount', () => {
  it('cero cuando no hay nada', () => {
    expect(pendingPromptCount({ permissions: {}, questions: {}, autoPending: {} })).toBe(0)
  })

  it('suma permisos y preguntas', () => {
    expect(pendingPromptCount({ permissions: { a: perm('a'), b: perm('b') }, questions: { q: {} as never }, autoPending: {} })).toBe(3)
  })

  it('los permisos que el Modo auto está considerando no cuentan (no se le muestran al usuario)', () => {
    expect(pendingPromptCount({ permissions: { a: perm('a'), b: perm('b') }, questions: {}, autoPending: { a: true } })).toBe(1)
  })
})
