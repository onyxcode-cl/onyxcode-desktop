import type { Message } from '@opencode-ai/sdk/v2/client'
import { describe, expect, it } from 'vitest'
import { lastAssistantFailed } from './errors'

const asst = (error?: { name: string }): { info: Message } => ({
  info: { id: 'a', role: 'assistant', ...(error ? { error } : {}) } as unknown as Message
})

describe('lastAssistantFailed', () => {
  it('detecta un error en el último mensaje del asistente', () => {
    expect(lastAssistantFailed([asst({ name: 'APIError' })])).toBe(true)
  })
  it('ignora abortos, mensajes sin error y listas vacías', () => {
    expect(lastAssistantFailed([asst({ name: 'MessageAbortedError' })])).toBe(false)
    expect(lastAssistantFailed([asst()])).toBe(false)
    expect(lastAssistantFailed([])).toBe(false)
  })
})
