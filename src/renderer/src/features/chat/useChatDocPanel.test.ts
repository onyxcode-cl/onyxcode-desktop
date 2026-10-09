import { describe, expect, it } from 'vitest'
import { assistantMessage, textPart, userMessage } from '../../../../test/fixtures/events'
import type { MessageEntry } from '../../stores/sessions'
import { lastDocBlock } from './useChatDocPanel'

const HTML = '```html\n<!doctype html><html><body><h1>hola</h1></body></html>\n```'
const XLSX = '```xlsx\n{"sheets":[{"name":"Gastos","rows":[["x"]]}]}\n```'

function entry(role: 'user' | 'assistant', text: string, id = 'm1'): MessageEntry {
  const info = role === 'assistant' ? assistantMessage(id, 's1') : userMessage(id, 's1')
  return { info, parts: [textPart(`${id}-p1`, id, 's1', text)] }
}

describe('lastDocBlock', () => {
  it('toma el ÚLTIMO bloque de documento del último mensaje del agente', () => {
    const entries = [entry('user', 'hazme un pdf'), entry('assistant', `aquí tienes:\n\n${HTML}`)]
    const found = lastDocBlock(entries)
    expect(found?.kind).toBe('html')
    expect(found?.rawText).toContain('<h1>hola</h1>')
  })

  it('con varios bloques en el mismo mensaje, se queda con el ÚLTIMO (no el primero), sin importar el tipo', () => {
    const entries = [entry('assistant', `${HTML}\n\ntexto en el medio\n\n${XLSX}`)]
    const found = lastDocBlock(entries)
    expect(found?.kind).toBe('xlsx')
  })

  it('el último mensaje es del usuario (no del agente): no hay nada que mostrar', () => {
    const entries = [entry('assistant', HTML), entry('user', '¿y en inglés?', 'm2')]
    expect(lastDocBlock(entries)).toBeNull()
  })

  it('el agente respondió sin ningún bloque de documento: null, no lanza', () => {
    const entries = [entry('assistant', 'Claro, aquí tienes la explicación en texto plano.')]
    expect(lastDocBlock(entries)).toBeNull()
  })

  it('sin mensajes: null, no lanza', () => {
    expect(lastDocBlock([])).toBeNull()
  })

  it('un bloque html vacío no cuenta', () => {
    const entries = [entry('assistant', '```html\n\n```')]
    expect(lastDocBlock(entries)).toBeNull()
  })
})
