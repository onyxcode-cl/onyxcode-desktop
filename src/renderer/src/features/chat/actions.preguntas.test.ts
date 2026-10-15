/**
 * Preguntas con opciones del agente de Chat (herramienta `question`): carga desde el servidor, eventos
 * asked/replied/rejected, responder y omitir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpencodeClient } from '../../lib/opencode'
import { makeSession } from '../../../../test/fixtures/events'

vi.mock('../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const CHAT = '/data/chat-workspace'
const Q = [{ header: 'Formato', question: '¿Cuál prefieres?', options: [{ label: 'A', description: 'a' }], multiple: false }]

async function setup(list: unknown[] = []) {
  const question = {
    list: vi.fn(() => Promise.resolve({ data: list })),
    reply: vi.fn(() => Promise.resolve({ data: true })),
    reject: vi.fn(() => Promise.resolve({ data: true }))
  }
  const { useServer } = await import('../../stores/server')
  useServer.setState({
    client: { question } as unknown as OpencodeClient,
    connection: { baseUrl: 'http://x', authorization: 'a', chatDirectory: CHAT } as never
  })
  const { useSessions } = await import('../../stores/sessions')
  useSessions.getState().upsertSession(makeSession('s1', CHAT))
  useSessions.getState().upsertSession(makeSession('code1', '/otro'))
  const { useChat } = await import('./store')
  const actions = await import('./actions')
  const { routeEventToSessions } = await import('../../stores/eventRouter')
  return { question, useChat, actions, routeEventToSessions }
}

beforeEach(() => {
  vi.resetModules()
  localStorage.clear()
})

describe('preguntas del Chat', () => {
  it('question.asked de una sesión de Chat queda pendiente; replied la limpia', async () => {
    const { useChat, routeEventToSessions } = await setup()
    routeEventToSessions({ type: 'question.asked', properties: { id: 'q1', sessionID: 's1', questions: Q } } as never, CHAT)
    expect(Object.keys(useChat.getState().questions)).toEqual(['q1'])
    routeEventToSessions({ type: 'question.replied', properties: { sessionID: 's1', requestID: 'q1', answers: [['A']] } } as never, CHAT)
    expect(useChat.getState().questions).toEqual({})
  })

  it('question.rejected la limpia y una pregunta de Code no entra al Chat', async () => {
    const { useChat, routeEventToSessions } = await setup()
    routeEventToSessions({ type: 'question.asked', properties: { id: 'q2', sessionID: 's1', questions: Q } } as never, CHAT)
    routeEventToSessions({ type: 'question.asked', properties: { id: 'qc', sessionID: 'code1', questions: Q } } as never, '/otro')
    expect(Object.keys(useChat.getState().questions)).toEqual(['q2'])
    routeEventToSessions({ type: 'question.rejected', properties: { sessionID: 's1', requestID: 'q2' } } as never, CHAT)
    expect(useChat.getState().questions).toEqual({})
  })

  it('loadChatQuestions reconstruye desde el servidor (solo sesiones de Chat)', async () => {
    const { useChat, actions } = await setup([
      { id: 'q1', sessionID: 's1', questions: Q },
      { id: 'qc', sessionID: 'code1', questions: Q }
    ])
    useChat.getState().addQuestion({ id: 'viejo', sessionID: 's1', questions: Q })
    await actions.loadChatQuestions()
    expect(Object.keys(useChat.getState().questions)).toEqual(['q1'])
  })

  it('replyChatQuestion envía las respuestas y limpia; rejectChatQuestion también', async () => {
    const { question, useChat, actions } = await setup()
    const q = { id: 'q1', sessionID: 's1', questions: Q }
    useChat.getState().addQuestion(q)
    await actions.replyChatQuestion(q, [['A']])
    expect(question.reply).toHaveBeenCalledWith({ requestID: 'q1', answers: [['A']], directory: CHAT })
    expect(useChat.getState().questions).toEqual({})
    useChat.getState().addQuestion(q)
    await actions.rejectChatQuestion(q)
    expect(question.reject).toHaveBeenCalledWith({ requestID: 'q1', directory: CHAT })
    expect(useChat.getState().questions).toEqual({})
  })

  it('si el servidor rechaza la respuesta, la pregunta sigue pendiente y el error sube a la tarjeta', async () => {
    const { question, useChat, actions } = await setup()
    question.reply.mockResolvedValueOnce({ error: { message: 'boom' } } as never)
    const q = { id: 'q1', sessionID: 's1', questions: Q }
    useChat.getState().addQuestion(q)
    await expect(actions.replyChatQuestion(q, [['A']])).rejects.toThrow()
    expect(Object.keys(useChat.getState().questions)).toEqual(['q1'])
  })
})
