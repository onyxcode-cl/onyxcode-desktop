import { describe, expect, it } from 'vitest'
import { buildTasksSystemPrompt, interfaceLanguageSection } from './tasks-prompt'

describe('contexto del idioma de la interfaz', () => {
  it('con español (o sin idioma) el prompt no cambia', () => {
    expect(buildTasksSystemPrompt({ lang: 'es' })).toBeUndefined()
    expect(buildTasksSystemPrompt({})).toBeUndefined()
    expect(interfaceLanguageSection('es')).toBe('')
  })
  it('con inglés traduce los botones que los prompts citan en español', () => {
    const s = buildTasksSystemPrompt({ lang: 'en' }) ?? ''
    expect(s).toContain('Interface language: English')
    expect(s).toContain('«Permitir borrar, mover y renombrar» → "Allow delete, move and rename"')
    expect(s).toContain('«Usar memoria» → "Use memory"')
    expect(s).toContain('«Guardar como PDF» → "Save as PDF"')
  })
  it('va al final, tras las demás secciones', () => {
    const s = buildTasksSystemPrompt({ lang: 'en', globalInstructions: 'Sé breve', unattended: true }) ?? ''
    expect(s.indexOf('Sé breve')).toBeLessThan(s.indexOf('Interface language'))
    expect(s.indexOf('PROGRAMADA')).toBeLessThan(s.indexOf('Interface language'))
  })
})

describe('memoria aprendida (2026-10-07)', () => {
  it('learningEnabled: false → aviso de apagado, sin memoria aprendida aunque haya contenido', () => {
    const s = buildTasksSystemPrompt({ learningEnabled: false, learnedUser: 'le gusta X' }) ?? ''
    expect(s).toContain('aprendizaje automático está desactivado')
    expect(s).not.toContain('le gusta X')
  })
  it('con learningEnabled (por defecto) se inyecta la memoria global aprobada', () => {
    const s = buildTasksSystemPrompt({ learnedUser: 'prefiere tablas' }) ?? ''
    expect(s).toContain('Memoria aprendida del usuario')
    expect(s).toContain('prefiere tablas')
  })
  it('la de proyecto se omite si el proyecto tiene la memoria desactivada (memoryEnabled: false)', () => {
    const s =
      buildTasksSystemPrompt({
        project: { name: 'x', memoryEnabled: false },
        learnedProject: 'convención X'
      }) ?? ''
    expect(s).not.toContain('convención X')
  })
  it('sin contenido aprobado, no agrega secciones de memoria (aunque learningEnabled sea true)', () => {
    expect(buildTasksSystemPrompt({ learnedUser: '', learnedProject: '' })).toBeUndefined()
  })
  it('ejecución desatendida (rutinas): puede proponer memoria, pero avisa que queda pendiente de revisión, y muestra la ya aprobada', () => {
    const s = buildTasksSystemPrompt({ learnedUser: 'ya aprobado', unattended: true }) ?? ''
    expect(s).toContain('ya aprobado')
    expect(s).toContain('pendiente de revisión')
    expect(s).not.toContain('no propongas memoria nueva')
  })
  it('learningSupported: false omite toda la sección de memoria, aunque haya memoria ya aprobada o esté desactivada', () => {
    const s1 = buildTasksSystemPrompt({ learnedUser: 'ya aprobado', learningSupported: false }) ?? ''
    expect(s1).toBe('')
    const s2 = buildTasksSystemPrompt({ learningEnabled: false, learningSupported: false }) ?? ''
    expect(s2).toBe('')
  })
  it('learningSupported: false + unattended: igual omite la memoria, pero mantiene el aviso general de ejecución desatendida', () => {
    const s = buildTasksSystemPrompt({ learnedUser: 'ya aprobado', unattended: true, learningSupported: false }) ?? ''
    expect(s).not.toContain('ya aprobado')
    expect(s).not.toContain('pendiente de revisión')
    expect(s).toContain('PROGRAMADA y desatendida')
  })
})
