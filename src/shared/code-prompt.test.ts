import { describe, expect, it } from 'vitest'
import { buildCodeSystemPrompt } from './code-prompt'

describe('buildCodeSystemPrompt', () => {
  it('learningEnabled: false → aviso de apagado, sin memoria aprendida aunque haya contenido', () => {
    const s = buildCodeSystemPrompt({ learningEnabled: false, learnedUser: 'ya aprobado' })
    expect(s).toContain('desactivado')
    expect(s).not.toContain('ya aprobado')
  })

  it('con learningEnabled (por defecto) inyecta la memoria global aprobada y la invitación a proponer', () => {
    const s = buildCodeSystemPrompt({ learnedUser: 'prefiere tablas' }) ?? ''
    expect(s).toContain('prefiere tablas')
    expect(s).toContain('lazunox-memoria')
    expect(s).toContain('alcance":"usuario"')
  })

  it('sin memoria aprobada: igual invita a proponer (nunca undefined cuando learningEnabled no es false)', () => {
    const s = buildCodeSystemPrompt({})
    expect(s).toBeDefined()
    expect(s).toContain('lazunox-memoria')
  })

  it('siempre dice alcance "usuario": Code no valida carpetas de proyecto', () => {
    const s = buildCodeSystemPrompt({}) ?? ''
    expect(s).toContain('memoria por proyecto')
  })
})
