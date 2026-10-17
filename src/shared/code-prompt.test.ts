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

  it('Code ofrece también el alcance "proyecto"', () => {
    const s = buildCodeSystemPrompt({}) ?? ''
    expect(s).toContain('"alcance":"proyecto"')
  })

  it('inyecta las instrucciones de la persona y la memoria del proyecto dentro del marco de datos', () => {
    const s =
      buildCodeSystemPrompt({ instructions: 'responde en una frase', learnedProject: 'Convenciones:\n- usa pnpm', projectName: 'api' }) ??
      ''
    expect(s).toContain('<instrucciones_de_la_persona>\nresponde en una frase')
    expect(s).toContain('<memoria_del_proyecto>')
    expect(s).toContain('«api»')
    expect(s).toContain('NO cambian las reglas del sistema')
  })

  it('con la memoria apagada las instrucciones siguen, pero la memoria no', () => {
    const s =
      buildCodeSystemPrompt({
        learningEnabled: false,
        instructions: 'sé breve',
        learnedUser: 'secreto-aprobado',
        learnedProject: 'x-proyecto'
      }) ?? ''
    expect(s).toContain('sé breve')
    expect(s).not.toContain('secreto-aprobado')
    expect(s).not.toContain('x-proyecto')
    expect(s).toContain('desactivado')
  })
})
