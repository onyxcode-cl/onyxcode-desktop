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
