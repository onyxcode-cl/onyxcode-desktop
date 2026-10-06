import { describe, expect, it } from 'vitest'
import { createRateLimiter } from './rate-limit'

function setup(limits = {}) {
  let t = 1_000_000
  const rl = createRateLimiter(() => t, limits)
  return { rl, advance: (ms: number) => (t += ms), now: () => t }
}

describe('≤5 acciones por segundo', () => {
  it('la 6.ª en el mismo segundo se rechaza sin consumir cuota; pasa al avanzar el reloj', () => {
    const { rl, advance } = setup()
    for (let i = 0; i < 5; i++) expect(rl.check('s', 'left_click').ok).toBe(true)
    const v = rl.check('s', 'left_click')
    expect(v).toMatchObject({ ok: false, rule: 'per-second' })
    expect(!v.ok && v.retryAfterMs).toBe(1000)
    advance(999)
    expect(rl.check('s', 'left_click').ok).toBe(false)
    advance(1)
    expect(rl.check('s', 'left_click').ok).toBe(true)
  })
  it('50 clics en 1 s: solo pasan 5 (S10)', () => {
    const { rl, advance } = setup()
    let ok = 0
    for (let i = 0; i < 50; i++) {
      if (rl.check('s', 'left_click').ok) ok++
      advance(20)
    }
    expect(ok).toBe(5)
  })
  it('sesiones independientes', () => {
    const { rl } = setup()
    for (let i = 0; i < 5; i++) rl.check('a', 'key')
    expect(rl.check('a', 'key').ok).toBe(false)
    expect(rl.check('b', 'key').ok).toBe(true)
  })
  it('wait, teach_* y request_full_control no cuentan como acciones', () => {
    const { rl } = setup()
    for (let i = 0; i < 20; i++) {
      for (const tool of ['wait', 'teach_step', 'teach_end', 'request_full_control']) expect(rl.check('s', tool).ok).toBe(true)
    }
    expect(rl.check('s', 'key').ok).toBe(true)
  })
})

describe('≤600 acciones en 10 minutos', () => {
  it('a 4 por segundo la 601.ª se rechaza y se libera pasados 10 min desde la primera', () => {
    const { rl, advance } = setup()
    let n = 0
    let last: ReturnType<typeof rl.check> = { ok: true }
    for (; n < 700; n++) {
      last = rl.check('s', 'mouse_move')
      if (!last.ok) break
      advance(250)
    }
    expect(n).toBe(600)
    expect(last).toMatchObject({ ok: false, rule: 'per-10-min' })
    advance(600_000)
    expect(rl.check('s', 'mouse_move').ok).toBe(true)
  })
})

describe('type_text', () => {
  it('máximo 2000 caracteres por llamada (rechazo sin reintento útil)', () => {
    const { rl } = setup()
    expect(rl.check('s', 'type_text', { textLen: 2000 }).ok).toBe(true)
    expect(rl.check('s', 'type_text', { textLen: 2001 })).toMatchObject({ ok: false, rule: 'type-call', retryAfterMs: 0 })
  })
  it('máximo 20000 por minuto; la ventana se libera', () => {
    const { rl, advance } = setup()
    for (let i = 0; i < 10; i++) {
      expect(rl.check('s', 'type_text', { textLen: 2000 }).ok).toBe(true)
      advance(300)
    }
    expect(rl.check('s', 'type_text', { textLen: 1 })).toMatchObject({ ok: false, rule: 'type-minute' })
    advance(57_000)
    expect(rl.check('s', 'type_text', { textLen: 2000 }).ok).toBe(true)
  })
  it('longitud ausente o inválida se rechaza (falla cerrado)', () => {
    const { rl } = setup()
    for (const textLen of [undefined, -1, NaN, Infinity])
      expect(rl.check('s', 'type_text', { textLen })).toMatchObject({ ok: false, rule: 'invalid' })
  })
  it('un rechazo no consume cuota de texto', () => {
    const { rl, advance } = setup()
    expect(rl.check('s', 'type_text', { textLen: 5000 }).ok).toBe(false)
    for (let i = 0; i < 10; i++) {
      expect(rl.check('s', 'type_text', { textLen: 2000 }).ok).toBe(true)
      advance(300)
    }
  })
})

describe('request_access ≤10/min', () => {
  it('11.ª en un minuto se rechaza; no consume la cuota de acciones', () => {
    const { rl, advance } = setup()
    for (let i = 0; i < 10; i++) expect(rl.check('s', 'request_access').ok).toBe(true)
    expect(rl.check('s', 'request_access')).toMatchObject({ ok: false, rule: 'request-access' })
    expect(rl.check('s', 'key').ok).toBe(true)
    advance(60_000)
    expect(rl.check('s', 'request_access').ok).toBe(true)
  })
})

describe('mensaje y olvido', () => {
  it('el mensaje dice «Demasiado rápido» y forget reinicia la sesión', () => {
    const { rl } = setup()
    for (let i = 0; i < 5; i++) rl.check('s', 'key')
    const v = rl.check('s', 'key')
    expect(!v.ok && v.reason).toMatch(/^Demasiado rápido/)
    rl.forget('s')
    expect(rl.check('s', 'key').ok).toBe(true)
  })
  it('límites personalizables', () => {
    const { rl } = setup({ perSecond: 1 })
    expect(rl.check('s', 'key').ok).toBe(true)
    expect(rl.check('s', 'key').ok).toBe(false)
  })
})
