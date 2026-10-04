import { describe, expect, it } from 'vitest'
import { PIN_LENGTH, pinInit, pinKeyFromEvent, pinPress, type PinMode, type PinPadState } from './pin-pad'

const d = (n: string) => ({ k: 'digit', d: n }) as const

function type(state: PinPadState, digits: string): { state: PinPadState; submit?: string } {
  let cur = { state } as { state: PinPadState; submit?: string }
  for (const ch of digits) cur = pinPress(cur.state, d(ch))
  return cur
}

describe('pin-pad', () => {
  it('añade cifras y no pasa de 6', () => {
    const r = type(pinInit('verify'), '123')
    expect(r.state.digits).toBe('123')
    expect(r.submit).toBeUndefined()
    // Tras enviar queda vacío: ninguna cifra extra se acumula.
    const full = type(pinInit('verify'), '1234567')
    expect(full.state.digits.length).toBeLessThanOrEqual(PIN_LENGTH)
  })

  it('verificar: envía solo al completar 6 y vacía el estado', () => {
    const r = type(pinInit('verify'), '123456')
    expect(r.submit).toBe('123456')
    expect(r.state.digits).toBe('')
    expect(JSON.stringify(r.state)).not.toContain('123456')
  })

  it('borrar quita una cifra y borrar todo vacía', () => {
    let r = type(pinInit('verify'), '1234')
    r = pinPress(r.state, { k: 'delete' })
    expect(r.state.digits).toBe('123')
    r = pinPress(r.state, { k: 'clear' })
    expect(r.state.digits).toBe('')
    expect(pinPress(r.state, { k: 'delete' }).state.digits).toBe('')
  })

  it('ignora teclas que no son cifras', () => {
    expect(pinPress(pinInit('verify'), d('a')).state.digits).toBe('')
    expect(pinKeyFromEvent('7')).toEqual(d('7'))
    expect(pinKeyFromEvent('Backspace')).toEqual({ k: 'delete' })
    expect(pinKeyFromEvent('Enter')).toBeNull()
    expect(pinKeyFromEvent('12')).toBeNull()
  })

  it('crear: dos pasos iguales envían el PIN', () => {
    const mode: PinMode = 'set'
    const a = type(pinInit(mode), '246810')
    expect(a.submit).toBeUndefined()
    expect(a.state.step).toBe(2)
    expect(a.state.digits).toBe('')
    const b = type(a.state, '246810')
    expect(b.submit).toBe('246810')
    expect(b.state.digits).toBe('')
    expect(b.state.first).toBe('')
  })

  it('crear: si no coinciden vuelve al paso 1 con error, que se limpia al teclear', () => {
    const a = type(pinInit('set'), '111111')
    const b = type(a.state, '111112')
    expect(b.submit).toBeUndefined()
    expect(b.state.step).toBe(1)
    expect(b.state.error).toBe('mismatch')
    expect(b.state.first).toBe('')
    expect(pinPress(b.state, d('5')).state.error).toBeNull()
  })
})
