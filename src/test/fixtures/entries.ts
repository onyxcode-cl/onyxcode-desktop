/** Entradas de conversación de ejemplo para los tests de render estático. */
import type { Part } from '@opencode-ai/sdk/v2/client'
import { assistantMessage, reasoningPart, textPart, toolPart, userMessage } from './events'

export interface Entry {
  info: ReturnType<typeof userMessage> | ReturnType<typeof assistantMessage>
  parts: Part[]
}

const S = 'ses_render'

export const userWithFile: Entry = {
  info: userMessage('msg_001', S),
  parts: [
    textPart('prt_001', 'msg_001', S, 'Revisa este archivo'),
    {
      id: 'prt_002',
      sessionID: S,
      messageID: 'msg_001',
      type: 'file',
      mime: 'text/plain',
      filename: 'notas.txt',
      url: 'file:///proj/notas.txt'
    } as Part
  ]
}

export const assistantFull: Entry = {
  info: assistantMessage('msg_002', S, { time: { created: 1000, completed: 3000 } }),
  parts: [
    reasoningPart('prt_003', 'msg_002', S, 'Pienso en la solución.', 4000),
    reasoningPart('prt_004', 'msg_002', S, 'Todavía razonando…'), // sin fin
    textPart('prt_005', 'msg_002', S, 'Hola, **mundo**.\n\n- uno\n- dos'),
    toolPart('prt_006', 'msg_002', S, 'bash', {
      status: 'completed',
      input: { command: 'ls' },
      output: 'a.txt',
      title: 'ls',
      metadata: {},
      time: { start: 1000, end: 2000 }
    }),
    toolPart('prt_007', 'msg_002', S, 'read', {
      status: 'error',
      input: { filePath: '/x' },
      error: 'No existe',
      time: { start: 1000, end: 1100 }
    })
  ]
}

export const assistantWithError: Entry = {
  info: assistantMessage('msg_003', S, { error: { name: 'APIError', data: { message: 'Límite alcanzado', isRetryable: false } } }),
  parts: []
}

export const assistantAborted: Entry = {
  info: assistantMessage('msg_004', S, { error: { name: 'MessageAbortedError', data: { message: 'abortado' } } }),
  parts: [textPart('prt_008', 'msg_004', S, 'Empecé a responder')]
}

export const allEntries: Entry[] = [userWithFile, assistantFull, assistantWithError, assistantAborted]
