import { describe, expect, it } from 'vitest'
import { assistantMessage, reasoningPart, textPart, userMessage } from '../../../../test/fixtures/events'
import type { MessageEntry } from '../../stores/sessions'
import { liveReasoningStart } from './useChatProgress'

function entry(role: 'user' | 'assistant', id: string, parts: MessageEntry['parts']): MessageEntry {
  const info = role === 'assistant' ? assistantMessage(id, 's1') : userMessage(id, 's1')
  return { info, parts }
}

describe('liveReasoningStart: hora de inicio del razonamiento EN VIVO del último mensaje', () => {
  it('sin mensajes: null', () => {
    expect(liveReasoningStart([])).toBeNull()
  })

  it('el último mensaje es del usuario: null (el agente todavía no respondió)', () => {
    const entries = [
      entry('assistant', 'a1', [reasoningPart('r1', 'a1', 's1', 'pensando', 2000)]),
      entry('user', 'u2', [textPart('p1', 'u2', 's1', '¿y en inglés?')])
    ]
    expect(liveReasoningStart(entries)).toBeNull()
  })

  it('razonamiento sin `time.end`: en vivo, devuelve su hora de inicio', () => {
    const entries = [entry('assistant', 'a1', [reasoningPart('r1', 'a1', 's1', 'pensando')])]
    expect(liveReasoningStart(entries)).toBe(1000)
  })

  it('razonamiento ya con `time.end`: terminado, null', () => {
    const entries = [entry('assistant', 'a1', [reasoningPart('r1', 'a1', 's1', 'pensando', 5000)])]
    expect(liveReasoningStart(entries)).toBeNull()
  })

  it('el último mensaje del agente no tiene ninguna parte reasoning: null', () => {
    const entries = [entry('assistant', 'a1', [textPart('p1', 'a1', 's1', 'hola')])]
    expect(liveReasoningStart(entries)).toBeNull()
  })
})
