import { describe, expect, it } from 'vitest'
import {
  findPlanQuestion,
  isPlanQuestion,
  parsePlanDecided,
  parsePlanReady,
  PLAN_APPROVE,
  PLAN_KEEP,
  planAnswers,
  planQuestionIds,
  type QuestionLike
} from './plan-mode'

const LISTO = {
  sessionID: 'ses_1',
  messageID: 'msg_1',
  callID: 'call_1',
  ruta: '.opencode/plans/1-plan.md',
  rutaAbsoluta: '/p/.opencode/plans/1-plan.md',
  contenido: '# Plan\n- paso 1',
  truncado: false,
  bytes: 15
}
const q = (over: Partial<QuestionLike> = {}): QuestionLike => ({
  id: 'que_1',
  sessionID: 'ses_1',
  tool: { messageID: 'msg_1', callID: 'call_1' },
  questions: [{ options: [{ label: PLAN_APPROVE }, { label: PLAN_KEEP }] }],
  ...over
})

describe('session.plan.listo', () => {
  it('lee el evento completo', () => {
    expect(parsePlanReady(LISTO)).toEqual(LISTO)
  })
  it('messageID y callID son opcionales; sin sessionID o sin contenido se descarta', () => {
    const min = { sessionID: 'ses_1', ruta: 'r', rutaAbsoluta: '/r', contenido: 'x', truncado: false, bytes: 1 }
    expect(parsePlanReady(min)).toEqual(min)
    expect(parsePlanReady({ ...LISTO, sessionID: '' })).toBeNull()
    expect(parsePlanReady({ ...LISTO, contenido: 5 })).toBeNull()
    expect(parsePlanReady(null)).toBeNull()
    expect(parsePlanReady('x')).toBeNull()
  })
  it('el texto es plano: sin controles ni marcas de dirección; Markdown y enlaces se quedan como texto', () => {
    const p = parsePlanReady({ ...LISTO, contenido: '[x](javascript:alert(1))‮\u0000 <b>hola</b>', ruta: 'a\nb' })!
    expect(p.contenido).toBe('[x](javascript:alert(1)) <b>hola</b>')
    expect(p.ruta).toBe('a b')
  })
  it('acota el contenido a 48 KB', () => {
    const p = parsePlanReady({ ...LISTO, contenido: 'x'.repeat(100_000), truncado: true })!
    expect(p.contenido.length).toBeLessThanOrEqual(48 * 1024 + 1)
    expect(p.truncado).toBe(true)
  })
})

describe('session.plan.decidido', () => {
  it('solo aprobado o seguir', () => {
    expect(parsePlanDecided({ sessionID: 's', decision: 'aprobado', ruta: 'r', callID: 'c' })).toEqual({
      sessionID: 's',
      decision: 'aprobado',
      ruta: 'r',
      callID: 'c'
    })
    expect(parsePlanDecided({ sessionID: 's', decision: 'otra', ruta: 'r' })).toBeNull()
    expect(parsePlanDecided({ decision: 'seguir' })).toBeNull()
  })
})

describe('reconocer la pregunta del plan', () => {
  it('coincide por callID, misma sesión y las dos opciones fijas', () => {
    expect(isPlanQuestion(q(), LISTO)).toBe(true)
    expect(findPlanQuestion(LISTO, [q({ id: 'otra', tool: { callID: 'zzz' } }), q()])?.id).toBe('que_1')
  })
  it('otro callID, otra sesión, sin callID, opciones distintas o varias preguntas: NO es la del plan', () => {
    expect(isPlanQuestion(q({ tool: { callID: 'x' } }), LISTO)).toBe(false)
    expect(isPlanQuestion(q({ tool: undefined }), LISTO)).toBe(false)
    expect(isPlanQuestion(q({ sessionID: 'ses_2' }), LISTO)).toBe(false)
    expect(isPlanQuestion(q(), { sessionID: 'ses_1' })).toBe(false)
    expect(isPlanQuestion(q({ questions: [{ options: [{ label: PLAN_APPROVE }] }] }), LISTO)).toBe(false)
    expect(isPlanQuestion(q({ questions: [{ options: [{ label: 'Sí' }, { label: 'No' }] }] }), LISTO)).toBe(false)
    expect(isPlanQuestion(q({ questions: [q().questions[0]!, q().questions[0]!] }), LISTO)).toBe(false)
  })
  it('planQuestionIds oculta solo las preguntas de plan', () => {
    const ids = planQuestionIds([parsePlanReady(LISTO)!], [q(), q({ id: 'gen', tool: { callID: 'otro' } })])
    expect([...ids]).toEqual(['que_1'])
  })
})

describe('respuestas exactas', () => {
  it('cada botón manda una sola opción con el texto exacto del motor', () => {
    expect(planAnswers('aprobado')).toEqual([['Aprobar y editar con preguntas']])
    expect(planAnswers('seguir')).toEqual([['Seguir planificando']])
  })
})
