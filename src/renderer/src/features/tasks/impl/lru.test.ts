/**
 * LRU de `messages` en Tareas (docs/LRU-PLAN.md, paso 5): guardas de la tarea activa, la Consulta lateral y
 * los permisos/preguntas pendientes (con su raíz e hijas), y semilla de la caché de búsqueda al desalojar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PermissionRequest, QuestionRequest } from '@opencode-ai/sdk/v2/client'
import { makeSession, msgUpdated, partUpdated, textPart, userMessage } from '../../../../../test/fixtures/events'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

const D = '/proj'
const TASKS_SRC = 'http://cw'
type Sessions = (typeof import('../../../stores/sessions'))['useSessions']
let useSessions: Sessions
let useTasks: (typeof import('./store'))['useTasks']
let cachedTranscriptTexts: (typeof import('./search'))['cachedTranscriptTexts']

beforeEach(async () => {
  vi.resetModules()
  localStorage.clear()
  localStorage.setItem('onyx.lru.max', '1')
  ;({ useSessions } = await import('../../../stores/sessions'))
  ;({ useTasks } = await import('./store')) // registra la guarda de Tasks
  ;({ cachedTranscriptTexts } = await import('./search')) // registra el oyente de búsqueda
})

function seed(id: string, over: { parentID?: string; text?: string; source?: string } = {}): void {
  const st = useSessions.getState()
  st.upsertSession(makeSession(id, D, { parentID: over.parentID, time: { created: 1, updated: 77 } }), over.source ?? TASKS_SRC)
  st.applyEvent(msgUpdated(userMessage(`msg_${id}`, id), D).event)
  st.applyEvent(partUpdated(textPart(`prt_${id}`, `msg_${id}`, id, over.text ?? `texto de ${id}`), D).event)
  useSessions.setState((s) => ({ loaded: { ...s.loaded, [id]: true } }))
}
const keys = (): string[] => Object.keys(useSessions.getState().messages).sort()

describe('guardas de Tasks', () => {
  it('la tarea activa no se desaloja', () => {
    for (const id of ['t1', 't2', 't3']) seed(id)
    useTasks.setState({ activeTaskId: 't1' })
    useSessions.getState().touchSession('t3')
    expect(keys()).toContain('t1')
    expect(keys()).toHaveLength(2) // t1 (fijada) + 1 de tope
  })

  it('la Consulta lateral fija su tarea y su sesión hija', () => {
    for (const id of ['t1', 't2', 't3']) seed(id)
    seed('side', { parentID: 't1' })
    useTasks.setState({ sideChat: { taskId: 't1', sessionId: 'side' } })
    useSessions.getState().touchSession('t3')
    expect(keys()).toEqual(expect.arrayContaining(['t1', 'side']))
  })

  it('un permiso pendiente en una subtarea fija la subtarea y su raíz', () => {
    for (const id of ['t2', 't3', 't4']) seed(id)
    seed('root')
    seed('sub', { parentID: 'root' })
    useTasks.setState({ permissions: { p1: { id: 'p1', sessionID: 'sub' } as PermissionRequest } })
    useSessions.getState().touchSession('t4')
    expect(keys()).toEqual(expect.arrayContaining(['root', 'sub']))
  })

  it('una pregunta pendiente fija la sesión (y sus hijas)', () => {
    for (const id of ['t2', 't3', 't4']) seed(id)
    seed('asking')
    seed('kid', { parentID: 'asking' })
    useTasks.setState({ questions: { q1: { id: 'q1', sessionID: 'asking', questions: [] } as unknown as QuestionRequest } })
    useSessions.getState().touchSession('t4')
    expect(keys()).toEqual(expect.arrayContaining(['asking', 'kid']))
  })
})

describe('búsqueda: semilla de la caché al desalojar (D4)', () => {
  it('el texto de una tarea de Tasks desalojada queda en la caché con su `updated`', () => {
    seed('old', { text: 'Aquí va la clave secreta' })
    seed('new')
    useSessions.getState().touchSession('new')
    expect(keys()).toEqual(['new']) // tope 1: sale 'old'
    const texts = cachedTranscriptTexts('old', 77)
    expect(texts?.map((t) => t.text)).toEqual(['Aquí va la clave secreta'])
    expect(cachedTranscriptTexts('old', 78)).toBeUndefined() // la tarea cambió después
  })

  it('no siembra sesiones del origen principal (Chat) ni listas parciales', () => {
    seed('chat', { source: 'main' })
    seed('new')
    useSessions.getState().touchSession('new')
    expect(keys()).toEqual(['new'])
    expect(cachedTranscriptTexts('chat', 77)).toBeUndefined()
  })
})
