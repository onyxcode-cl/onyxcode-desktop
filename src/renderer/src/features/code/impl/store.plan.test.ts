/**
 * Modo plan (`session.plan.listo|decidido`) en el store de Code: solo con la bandera `modoPlan`, la pregunta del plan se reconoce por el
 * `callID`, los botones contestan con la respuesta exacta y la tarjeta se quita al decidir.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeSession, resetEventIds, sessionCreated, type TraceEvent } from '../../../../../test/fixtures/events'
import type { OcEvent } from '../../../lib/opencode'
import { PLAN_APPROVE, PLAN_KEEP } from '@shared/plan-mode'

vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

type Store = typeof import('./store')
let useCode: Store['useCode']
let useServer: (typeof import('../../../stores/server'))['useServer']
let useSettings: (typeof import('../../../stores/settings'))['useSettings']
const D = '/work/code'

beforeEach(async () => {
  vi.resetModules()
  resetEventIds()
  ;({ useCode } = await import('./store'))
  ;({ useServer } = await import('../../../stores/server'))
  ;({ useSettings } = await import('../../../stores/settings'))
  useCode.setState({ directory: D })
})

const st = (): ReturnType<Store['useCode']['getState']> => useCode.getState()
const apply = (te: TraceEvent): void => st().applyEvent(te.event, te.directory)
let n = 0
const ev = (type: string, properties: unknown, directory = D): TraceEvent => ({
  event: { id: `evt_pl_${++n}`, type, properties } as unknown as OcEvent,
  directory
})
const flag = (on: boolean): void => {
  useSettings.setState({ settings: { ...useSettings.getState().settings, modoPlan: on } })
}

const listo = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  sessionID: 's1',
  messageID: 'm1',
  callID: 'call_1',
  ruta: '.opencode/plans/p.md',
  rutaAbsoluta: `${D}/.opencode/plans/p.md`,
  contenido: '# Plan\n- uno',
  truncado: false,
  bytes: 12,
  ...over
})
const asked = (id = 'que_1', callID = 'call_1'): Record<string, unknown> => ({
  id,
  sessionID: 's1',
  tool: { messageID: 'm1', callID },
  questions: [
    {
      question: '¿Aprobar?',
      header: 'Plan',
      options: [
        { label: PLAN_APPROVE, description: '' },
        { label: PLAN_KEEP, description: '' }
      ],
      custom: false
    }
  ]
})

function install(): { reply: ReturnType<typeof vi.fn> } {
  const reply = vi.fn(() => Promise.resolve({ data: true }))
  useServer.setState({
    client: {
      permission: { reply: vi.fn(), list: () => Promise.resolve({ data: [] }) },
      session: { abort: vi.fn(), update: vi.fn(), status: () => Promise.resolve({ data: {} }), list: () => Promise.resolve({ data: [] }) },
      question: { list: () => Promise.resolve({ data: [] }), reply, reject: vi.fn(() => Promise.resolve({ data: true })) }
    } as never,
    connection: { baseUrl: 'http://127.0.0.1:4999', authorization: 'Basic abc', chatDirectory: '/chat' } as never
  })
  return { reply }
}

describe('bandera apagada (por defecto)', () => {
  it('session.plan.listo se ignora y la pregunta sigue siendo una pregunta común', () => {
    install()
    flag(false)
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('session.plan.listo', listo()))
    expect(st().plans).toEqual({})
    apply(ev('question.asked', asked()))
    expect(Object.keys(st().questions)).toEqual(['que_1'])
  })
})

describe('bandera encendida', () => {
  beforeEach(() => flag(true))

  it('listo guarda el plan saneado; uno mal formado o de otro proyecto se ignora', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('session.plan.listo', listo({ contenido: 'Hola‮ <script>' })))
    expect(st().plans.s1?.contenido).toBe('Hola <script>')
    expect(st().unread.s1).toBeDefined()
    apply(ev('session.plan.listo', { sessionID: 's1' }))
    apply(ev('session.plan.listo', listo({ sessionID: 's_ajena' }), '/otro'))
    expect(Object.keys(st().plans)).toEqual(['s1'])
  })

  it('question.asked conserva tool.callID', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('question.asked', asked()))
    expect(st().questions.que_1?.tool).toEqual({ messageID: 'm1', callID: 'call_1' })
  })

  it('«Aprobar» responde la pregunta con la respuesta exacta y quita la tarjeta', async () => {
    const { reply } = install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('session.plan.listo', listo()))
    apply(ev('question.asked', asked()))
    expect(await st().decidePlan(st().plans.s1!, 'aprobado')).toBe(true)
    expect(reply).toHaveBeenCalledWith({ requestID: 'que_1', answers: [[PLAN_APPROVE]], directory: D })
    expect(st().plans).toEqual({})
    expect(st().questions).toEqual({})
  })

  it('«Seguir planificando» responde con la otra opción', async () => {
    const { reply } = install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('session.plan.listo', listo()))
    apply(ev('question.asked', asked()))
    await st().decidePlan(st().plans.s1!, 'seguir')
    expect(reply).toHaveBeenCalledWith({ requestID: 'que_1', answers: [[PLAN_KEEP]], directory: D })
  })

  it('sin la pregunta (aún no llegó) o con otro callID NO responde a ciegas', async () => {
    const { reply } = install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('session.plan.listo', listo()))
    expect(await st().decidePlan(st().plans.s1!, 'aprobado')).toBe(false)
    apply(ev('question.asked', asked('que_2', 'call_OTRO')))
    expect(await st().decidePlan(st().plans.s1!, 'aprobado')).toBe(false)
    expect(reply).not.toHaveBeenCalled()
    expect(st().plans.s1).toBeDefined()
  })

  it('si la respuesta falla, la tarjeta se queda para reintentar', async () => {
    const { reply } = install()
    reply.mockImplementationOnce(() => Promise.reject(new Error('caído')))
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('session.plan.listo', listo()))
    apply(ev('question.asked', asked()))
    expect(await st().decidePlan(st().plans.s1!, 'aprobado')).toBe(false)
    expect(st().plans.s1).toBeDefined()
  })

  it('session.plan.decidido quita la tarjeta (y uno de otro plan no)', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('session.plan.listo', listo()))
    apply(ev('session.plan.decidido', { sessionID: 's1', callID: 'call_VIEJO', decision: 'seguir', ruta: 'r' }))
    expect(st().plans.s1).toBeDefined()
    apply(ev('session.plan.decidido', { sessionID: 's1', callID: 'call_1', decision: 'aprobado', ruta: 'r' }))
    expect(st().plans).toEqual({})
  })

  it('question.replied / rejected de la pregunta del plan también quitan la tarjeta', () => {
    install()
    apply(sessionCreated(makeSession('s1', D)))
    apply(ev('session.plan.listo', listo()))
    apply(ev('question.asked', asked()))
    apply(ev('question.rejected', { sessionID: 's1', requestID: 'que_1' }))
    expect(st().plans).toEqual({})
  })
})
