import { describe, expect, it } from 'vitest'
import { assistantMessage, textPart, userMessage } from '../../../test/fixtures/events'
import type { MessageEntry } from './session-reducer'
import { formatDuration, turnTiming } from './turn-timing'

function entry(role: 'user' | 'assistant', created: number, completed?: number, id = 'm1'): MessageEntry {
  const info =
    role === 'assistant'
      ? assistantMessage(id, 's1', { time: { created, ...(completed ? { completed } : {}) } })
      : userMessage(id, 's1', { time: { created } })
  return { info, parts: [textPart(`${id}-p1`, id, 's1', 'hola')] }
}

describe('formatDuration', () => {
  it('segundos: "0:42"', () => {
    expect(formatDuration(42_000)).toBe('0:42')
  })

  it('minutos: "12:05"', () => {
    expect(formatDuration(12 * 60_000 + 5_000)).toBe('12:05')
  })

  it('horas: "1:02:10"', () => {
    expect(formatDuration(62 * 60_000 + 10_000)).toBe('1:02:10')
  })

  it('negativo o cero: "0:00", nunca negativo', () => {
    expect(formatDuration(-500)).toBe('0:00')
    expect(formatDuration(0)).toBe('0:00')
  })
})

describe('turnTiming', () => {
  it('sin mensajes: start y end null', () => {
    expect(turnTiming([])).toEqual({ start: null, end: null })
  })

  it('toma el inicio del último mensaje del usuario y el fin del asistente que le siguió', () => {
    const entries = [entry('user', 1000, undefined, 'u1'), entry('assistant', 1100, 2000, 'a1')]
    expect(turnTiming(entries)).toEqual({ start: 1000, end: 2000 })
  })

  it('el asistente todavía no terminó: end null', () => {
    const entries = [entry('user', 1000, undefined, 'u1'), entry('assistant', 1100, undefined, 'a1')]
    expect(turnTiming(entries)).toEqual({ start: 1000, end: null })
  })

  it('solo mira el último mensaje de usuario, no uno más viejo', () => {
    const entries = [entry('user', 500, undefined, 'u0'), entry('assistant', 600, 700, 'a0'), entry('user', 1000, undefined, 'u1')]
    expect(turnTiming(entries)).toEqual({ start: 1000, end: null })
  })
})
