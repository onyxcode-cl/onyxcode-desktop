import { describe, expect, it } from 'vitest'
import { buildContinuationPrompt, escalationReason, ESCALATE_MARKER, needsFullAccess } from './EscalateCard'
import type { MessageEntry } from '../../../stores/sessions'

describe('needsFullAccess', () => {
  it('detecta la frase en español (sin tildes ni mayúsculas)', () => {
    expect(needsFullAccess('Listo.\n\n**Necesita Control total del Mac**: abrir Discord')).toBe(true)
    expect(needsFullAccess('NECESITA CONTROL TOTAL DEL MAC')).toBe(true)
  })
  it('detecta la frase en inglés', () => {
    expect(needsFullAccess('Done.\n\n**Needs Full Mac control**: open Discord')).toBe(true)
    expect(needsFullAccess('This needs full control of the Mac to continue')).toBe(true)
  })
  it('detecta el marcador neutro aunque el texto esté en otro idioma', () => {
    expect(needsFullAccess(`Ich brauche mehr Rechte.\n${ESCALATE_MARKER}`)).toBe(true)
  })
  it('no se activa con texto normal', () => {
    expect(needsFullAccess('Terminé el informe. Control total no hace falta.')).toBe(false)
    expect(needsFullAccess('')).toBe(false)
  })
})

describe('escalationReason', () => {
  it('extrae el motivo en español, en inglés y junto al marcador neutro', () => {
    expect(escalationReason('**Necesita Control total del Mac**: abrir Discord')).toBe('abrir Discord')
    expect(escalationReason('**Needs Full Mac control**: open Discord')).toBe('open Discord')
    expect(escalationReason(`Hay que abrir Discord ${ESCALATE_MARKER} motivo breve`)).toBe('motivo breve')
    expect(escalationReason(`**Needs Full Mac control**: open Discord\n${ESCALATE_MARKER}`)).toBe('open Discord')
    expect(escalationReason('nada')).toBe('')
  })
})

function entry(role: 'user' | 'assistant', text: string, id: string): MessageEntry {
  return { info: { id, role }, parts: [{ id: `${id}p`, type: 'text', text }] } as unknown as MessageEntry
}

describe('buildContinuationPrompt', () => {
  const entries = [entry('user', 'Escribe a Fulano', 'u1'), entry('assistant', 'Borrador listo', 'a1')]
  it('sigue el idioma de la interfaz', () => {
    expect(buildContinuationPrompt(entries, 'es')).toContain('Continúa en Control total del Mac')
    const en = buildContinuationPrompt(entries, 'en')
    expect(en).toContain('Continue this task')
    expect(en).toContain('Original request:\nEscribe a Fulano')
    expect(en).toContain('Borrador listo')
  })
})
