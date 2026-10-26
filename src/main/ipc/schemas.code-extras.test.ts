import { describe, expect, it } from 'vitest'
import { IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'

const CHANNELS = ['goal:get', 'goal:set', 'goal:clear', 'budget:get', 'budget:set', 'review:run']

describe('canales goal:* / budget:* / review:run (Objetivo, Presupuesto y Revisar cambios)', () => {
  it('existen en el contrato, tienen esquema y son solo de la ventana principal', () => {
    for (const c of CHANNELS) {
      expect(IPC_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })

  it('goal:get / goal:clear: id de sesión y carpeta opcional; sin rutas en el id ni claves extra', () => {
    for (const c of ['goal:get', 'goal:clear', 'budget:get']) {
      const v = IPC_SCHEMAS[c]!
      expect(v({ sessionID: 'ses_abc' })).toEqual({ sessionID: 'ses_abc' })
      expect(v({ sessionID: 'ses_abc', directory: '/proj' })).toEqual({ sessionID: 'ses_abc', directory: '/proj' })
      expect(() => v({})).toThrow()
      expect(() => v({ sessionID: '../x' })).toThrow()
      expect(() => v({ sessionID: 'a/b' })).toThrow()
      expect(() => v({ sessionID: 'ses_a', extra: 1 })).toThrow()
    }
  })

  it('goal:set: condición obligatoria y acotada; verificar y tope opcionales; el tope va de 1 a 25', () => {
    const v = IPC_SCHEMAS['goal:set']!
    expect(v({ sessionID: 'ses_a', condition: 'x' })).toEqual({ sessionID: 'ses_a', condition: 'x' })
    expect(v({ sessionID: 'ses_a', condition: 'x', verify: 'npm test', cap: 25, resume: true })).toMatchObject({ cap: 25, resume: true })
    expect(() => v({ sessionID: 'ses_a' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', condition: '' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', condition: 'x'.repeat(2001) })).toThrow()
    expect(() => v({ sessionID: 'ses_a', condition: 'x', verify: 'y'.repeat(1001) })).toThrow()
    expect(() => v({ sessionID: 'ses_a', condition: 'x', cap: 0 })).toThrow()
    expect(() => v({ sessionID: 'ses_a', condition: 'x', cap: 26 })).toThrow()
    expect(() => v({ sessionID: 'ses_a', condition: 'x', cap: 2.5 })).toThrow()
    expect(() => v({ sessionID: 'ses_a', condition: 'x', resume: 'si' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', condition: 'x', metadata: {} })).toThrow()
  })

  it('budget:set: números enteros dentro de rango, «continuar» booleano obligatorio, sin metadata libre', () => {
    const v = IPC_SCHEMAS['budget:set']!
    expect(v({ sessionID: 'ses_a', config: { continueOnCut: false } })).toEqual({ sessionID: 'ses_a', config: { continueOnCut: false } })
    expect(v({ sessionID: 'ses_a', config: { tokens: 50000, steps: 20, minutes: 60, continueOnCut: true } })).toMatchObject({
      config: { tokens: 50000, steps: 20, minutes: 60 }
    })
    for (const bad of [
      { tokens: 10 },
      { tokens: 50_000_001 },
      { steps: 0 },
      { steps: 10_001 },
      { minutes: 0 },
      { minutes: 1441 },
      { steps: 1.5 },
      { steps: '3' }
    ])
      expect(() => v({ sessionID: 'ses_a', config: { ...bad, continueOnCut: false } })).toThrow()
    expect(() => v({ sessionID: 'ses_a', config: {} })).toThrow()
    expect(() => v({ sessionID: 'ses_a' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', config: { continueOnCut: false, epoca: 1 } })).toThrow()
    expect(() => v({ sessionID: 'ses_a', config: { continueOnCut: false }, metadata: { x: 1 } })).toThrow()
  })

  it('review:run: sin comando ni argumentos del renderer; el modelo no lleva espacios', () => {
    const v = IPC_SCHEMAS['review:run']!
    expect(v({ sessionID: 'ses_a' })).toEqual({ sessionID: 'ses_a' })
    expect(v({ sessionID: 'ses_a', directory: '/p', model: 'opencode/big-pickle' })).toMatchObject({ model: 'opencode/big-pickle' })
    expect(() => v({ sessionID: 'ses_a', model: 'a b' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', model: 'a\nb' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', command: 'rm -rf' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', arguments: '--output=x' })).toThrow()
  })

  it('settings:set acepta codeExtras con los tres booleanos y rechaza claves extra o faltantes', () => {
    const v = IPC_SCHEMAS['settings:set']!
    const ok = {
      codeMode: { chat: false, code: false, tasks: false },
      backgroundSubagents: { chat: true, code: true, tasks: true },
      toolSearch: { chat: 'auto', code: 'auto', tasks: 'off' },
      mcpElicitation: { chat: true, code: true, tasks: false },
      codeExtras: { goal: false, budget: false, review: true }
    }
    expect(() => v({ engineExperiments: ok })).not.toThrow()
    expect(() => v({ engineExperiments: { ...ok, codeExtras: { goal: true } } })).toThrow()
    expect(() => v({ engineExperiments: { ...ok, codeExtras: { ...ok.codeExtras, extra: true } } })).toThrow()
    expect(() => v({ engineExperiments: { ...ok, codeExtras: { ...ok.codeExtras, goal: 'si' } } })).toThrow()
  })
})
