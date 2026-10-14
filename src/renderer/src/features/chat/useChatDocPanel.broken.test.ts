import { describe, expect, it } from 'vitest'
import { assistantMessage, textPart, userMessage } from '../../../../test/fixtures/events'
import type { MessageEntry } from '../../stores/sessions'
import { lastBrokenBlock, lastDocBlock } from './useChatDocPanel'

function entry(role: 'user' | 'assistant', text: string, id = 'm1'): MessageEntry {
  const info = role === 'assistant' ? assistantMessage(id, 's1') : userMessage(id, 's1')
  return { info, parts: [textPart(`${id}-p1`, id, 's1', text)] }
}

describe('lastBrokenBlock', () => {
  it('devuelve el bloque cerrado pero inválido del último mensaje del agente', () => {
    const entries = [entry('assistant', '```pptx\n{"slides": [roto]}\n```')]
    expect(lastBrokenBlock(entries)).toMatchObject({ kind: 'pptx', reason: 'json' })
  })

  it('null si el bloque es válido, si el último mensaje es del usuario o si no hay mensajes', () => {
    expect(lastBrokenBlock([entry('assistant', '```xlsx\n{"sheets":[{"name":"G","rows":[["x"]]}]}\n```')])).toBeNull()
    expect(lastBrokenBlock([entry('assistant', '```pptx\nroto\n```'), entry('user', 'otra vez', 'm2')])).toBeNull()
    expect(lastBrokenBlock([])).toBeNull()
  })

  it('un bloque de GPT con claves de más ya NO es «roto»: lastDocBlock lo encuentra', () => {
    const gpt = '```pptx\n{"title":"x","slides":[{"title":"Hola","notes":"n"}]}\n```'
    expect(lastBrokenBlock([entry('assistant', gpt)])).toBeNull()
    expect(lastDocBlock([entry('assistant', gpt)])?.kind).toBe('pptx')
  })
})
