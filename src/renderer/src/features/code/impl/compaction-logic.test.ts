import { describe, expect, it } from 'vitest'
import { compactableTurns, compactionPartOf, splitCompactionTurn, summaryTextOf } from './compaction-logic'

type M = { info: { id: string; role: string; summary?: unknown }; parts: { type: string; text?: string; synthetic?: boolean }[] }
const user = (id: string, text = 'hola'): M => ({ info: { id, role: 'user' }, parts: [{ type: 'text', text }] })
const compaction = (id: string): M => ({ info: { id, role: 'user' }, parts: [{ type: 'compaction' }] })
const asst = (id: string, over: Partial<M['info']> = {}, text = 'resp'): M => ({
  info: { id, role: 'assistant', ...over },
  parts: [{ type: 'text', text }]
})
const real = (u: M): boolean => u.parts.some((p) => p.type === 'text' && !!p.text)

describe('compactionPartOf', () => {
  it('encuentra la parte compaction', () => {
    expect(compactionPartOf(compaction('c').parts)?.type).toBe('compaction')
    expect(compactionPartOf(user('u').parts)).toBeUndefined()
    expect(compactionPartOf(undefined)).toBeUndefined()
  })
})

describe('splitCompactionTurn', () => {
  it('el mensaje marcado summary es el resumen y lo demás sigue su camino', () => {
    const a = asst('a1', { summary: true }, 'RESUMEN')
    const b = asst('a2', {}, 'sigo trabajando')
    const r = splitCompactionTurn([a, b])
    expect(r.summary).toEqual([a])
    expect(r.rest).toEqual([b])
    expect(summaryTextOf(r.summary)).toBe('RESUMEN')
  })
  it('si ningún mensaje está marcado, el resumen es la primera respuesta', () => {
    const a = asst('a1', {}, 'R')
    const b = asst('a2')
    expect(splitCompactionTurn([a, b])).toEqual({ summary: [a], rest: [b] })
    expect(splitCompactionTurn([])).toEqual({ summary: [], rest: [] })
  })
  it('el texto del resumen ignora partes sintéticas', () => {
    const a: M = {
      info: { id: 'a', role: 'assistant', summary: true },
      parts: [
        { type: 'text', text: 'uno' },
        { type: 'text', text: 'x', synthetic: true }
      ]
    }
    expect(summaryTextOf([a])).toBe('uno')
  })
})

describe('compactableTurns', () => {
  const turns = (...users: (M | null)[]): { user: M | null }[] => users.map((u) => ({ user: u }))
  it('el primer mensaje no (no hay nada que resumir antes) y el resto sí', () => {
    expect(compactableTurns(turns(user('1'), user('2'), user('3')), real)).toEqual([false, true, true])
  })
  it('solo los posteriores a la última compactación; la compactación misma no', () => {
    expect(compactableTurns(turns(user('1'), user('2'), compaction('c'), user('3'), user('4')), real)).toEqual([
      false,
      false,
      false,
      true,
      true
    ])
    expect(compactableTurns(turns(user('1'), compaction('c1'), user('2'), compaction('c2'), user('3')), real)).toEqual([
      false,
      false,
      false,
      false,
      true
    ])
  })
  it('mensajes sin contenido real (avisos sintéticos) ni turnos sin usuario no cuentan', () => {
    const empty = user('e', '')
    expect(compactableTurns(turns(null, empty, user('1'), user('2')), real)).toEqual([false, false, false, true])
  })
})
