import { describe, expect, it } from 'vitest'
import type { MessageEntry } from '../../../stores/sessions'
import { loadedTranscript } from './search'

const entries = [{ info: { id: 'm1', role: 'user' }, parts: [] }] as unknown as MessageEntry[]

describe('loadedTranscript (F6-B14)', () => {
  it('devuelve la lista solo si la sesión está cargada', () => {
    expect(loadedTranscript({ loaded: { a: true }, messages: { a: entries } }, 'a')).toBe(entries)
  })
  it('una lista parcial (no cargada) devuelve undefined aunque tenga mensajes', () => {
    expect(loadedTranscript({ loaded: {}, messages: { a: entries } }, 'a')).toBeUndefined()
  })
  it('cargada y vacía cuenta como cargada', () => {
    const empty: MessageEntry[] = []
    expect(loadedTranscript({ loaded: { a: true }, messages: { a: empty } }, 'a')).toBe(empty)
  })
  it('sin lista devuelve undefined', () => {
    expect(loadedTranscript({ loaded: { a: true }, messages: {} }, 'a')).toBeUndefined()
  })
})
