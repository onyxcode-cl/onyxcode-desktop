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

describe('ayudante bloqueado (solo presentación)', () => {
  it('reconoce el texto del guardián y la regla de Solo explorar', async () => {
    const { subagentBlockKind } = await import('./plan-gate')
    expect(
      subagentBlockKind(
        'Lanzamiento de subagente bloqueado por Lazunox: el subagente "general" tendria mas libertad que quien lo lanza (build): bash.'
      )
    ).toBe('escalation')
    expect(subagentBlockKind('Lanzamiento de subagente bloqueado por Lazunox: no se pudo leer la lista de agentes.')).toBe('unverified')
    expect(subagentBlockKind('The user has specified a rule which prevents you from using this specific tool call.')).toBe('rule')
    expect(subagentBlockKind('otro fallo')).toBeNull()
    expect(subagentBlockKind(undefined)).toBeNull()
  })
})
