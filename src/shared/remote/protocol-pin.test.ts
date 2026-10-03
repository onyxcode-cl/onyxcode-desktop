import { describe, expect, it } from 'vitest'
import { encodeFrame, parseClientFrame, parseHostFrame } from './protocol'

describe('protocolo: tramas de PIN y bloqueo (extensión v2)', () => {
  it('pin-set y pin-verify exigen exactamente 6 dígitos y ninguna clave extra', () => {
    for (const t of ['pin-set', 'pin-verify'] as const) {
      expect(parseClientFrame(JSON.stringify({ t, pin: '123456' }))).toEqual({ ok: true, value: { t, pin: '123456' } })
      for (const pin of ['12345', '1234567', 'abcdef', '12345a', ' 12345', 123456, null, undefined, '１２３４５６']) {
        expect(parseClientFrame(JSON.stringify({ t, pin })).ok, String(pin)).toBe(false)
      }
      expect(parseClientFrame(JSON.stringify({ t, pin: '123456', extra: 1 })).ok).toBe(false)
      expect(parseClientFrame(JSON.stringify({ t })).ok).toBe(false)
    }
  })

  it('locked y unlocked del Mac: valores acotados', () => {
    expect(parseHostFrame(JSON.stringify({ t: 'unlocked' })).ok).toBe(true)
    expect(parseHostFrame(JSON.stringify({ t: 'unlocked', x: 1 })).ok).toBe(false)
    for (const why of ['confirm', 'pin-set', 'pin-verify', 'inactive']) {
      expect(parseHostFrame(JSON.stringify({ t: 'locked', why })).ok, why).toBe(true)
    }
    expect(parseHostFrame(JSON.stringify({ t: 'locked', why: 'pin-verify', retryMs: 2000, left: 3 }))).toEqual({
      ok: true,
      value: { t: 'locked', why: 'pin-verify', retryMs: 2000, left: 3 }
    })
    for (const bad of [
      { why: 'otro' },
      { why: 'confirm', retryMs: -1 },
      { why: 'confirm', retryMs: 1.5 },
      { why: 'confirm', left: 'x' },
      { why: 'confirm', left: 1000 },
      { why: 'confirm', pin: '123456' }
    ]) {
      expect(parseHostFrame(JSON.stringify({ t: 'locked', ...bad })).ok, JSON.stringify(bad)).toBe(false)
    }
  })

  it('lock (bloqueo manual) no lleva ningún dato y el Mac no puede enviarlo', () => {
    expect(parseClientFrame(JSON.stringify({ t: 'lock' }))).toEqual({ ok: true, value: { t: 'lock' } })
    expect(parseClientFrame(JSON.stringify({ t: 'lock', pin: '123456' })).ok).toBe(false)
    expect(parseHostFrame(JSON.stringify({ t: 'lock' })).ok).toBe(false)
  })

  it('el Mac nunca puede enviar pin-* ni el celular locked/unlocked', () => {
    expect(parseHostFrame(JSON.stringify({ t: 'pin-verify', pin: '123456' })).ok).toBe(false)
    expect(parseClientFrame(JSON.stringify({ t: 'locked', why: 'confirm' })).ok).toBe(false)
    expect(parseClientFrame(JSON.stringify({ t: 'unlocked' })).ok).toBe(false)
  })

  it('se codifica y vuelve a leerse', () => {
    const s = encodeFrame({ t: 'locked', why: 'inactive' })!
    expect(parseHostFrame(s)).toEqual({ ok: true, value: { t: 'locked', why: 'inactive' } })
  })
})
