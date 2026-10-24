import { describe, expect, it } from 'vitest'
import { friendlyToolError, isRejectedText } from './plan-gate'

describe('rechazo de permisos', () => {
  it('reconoce el texto del motor cuando la persona rechaza (con o sin comentario)', () => {
    expect(isRejectedText('The user rejected permission to use this specific tool call.')).toBe(true)
    expect(isRejectedText('The user rejected permission to use this specific tool call. with the following feedback: no')).toBe(true)
    expect(isRejectedText('EPERM: operation not permitted')).toBe(false)
    expect(isRejectedText(undefined)).toBe(false)
  })
  it('lo muestra en llano también en el modo técnico de Code', () => {
    expect(friendlyToolError('The user rejected permission to use this specific tool call.', true)).toMatch(/Rechazaste/)
    expect(friendlyToolError('fallo normal\ncon dos líneas', true)).toBe('fallo normal\ncon dos líneas')
  })
})
