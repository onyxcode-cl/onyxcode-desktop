import { describe, expect, it } from 'vitest'
import {
  accountReducer,
  CLOCK_SKEW_MS,
  cleanCodeInput,
  decideAccess,
  GRACE_MS,
  INITIAL_ACCOUNT_STATE,
  isAccessOpen,
  isValidCode,
  isValidEmail,
  normalizeEmail,
  type AccountState,
  type StoredSession
} from './account'

const NOW = 1_800_000_000_000
const DAY = 24 * 60 * 60 * 1000
const S: StoredSession = { token: 't', email: 'a@b.cl', provider: 'email' }

describe('decideAccess', () => {
  it('GRACE_MS son 30 días', () => expect(GRACE_MS).toBe(30 * DAY))

  it('sin sesión guardada: bloquea como «sin cuenta» sin importar el servidor', () => {
    for (const r of [{ kind: 'ok' }, { kind: 'unreachable' }, { kind: 'http', status: 401 }] as const) {
      expect(decideAccess(NOW, null, NOW, r)).toEqual({ allowed: false, status: 'signed-out', clearSession: false, graceEndsAt: null })
    }
  })

  it('sesión válida: abre', () => {
    expect(decideAccess(NOW, S, null, { kind: 'ok' })).toEqual({
      allowed: true,
      status: 'signed-in',
      clearSession: false,
      graceEndsAt: null
    })
  })

  it('401: bloquea al instante y borra, aunque la última validación sea de ayer', () => {
    const d = decideAccess(NOW, S, NOW - DAY, { kind: 'http', status: 401 })
    expect(d).toEqual({ allowed: false, status: 'expired', clearSession: true, graceEndsAt: null })
  })

  it.each([404, 410])('%i: cuenta borrada, bloquea y borra', (status) => {
    expect(decideAccess(NOW, S, NOW - DAY, { kind: 'http', status })).toEqual({
      allowed: false,
      status: 'deleted',
      clearSession: true,
      graceEndsAt: null
    })
  })

  it('servidor caído dentro de gracia: entra y dice cuándo termina', () => {
    const last = NOW - 10 * DAY
    expect(decideAccess(NOW, S, last, { kind: 'unreachable' })).toEqual({
      allowed: true,
      status: 'grace',
      clearSession: false,
      graceEndsAt: last + GRACE_MS
    })
  })

  it('servidor caído justo antes del límite entra; en el límite exacto bloquea', () => {
    expect(decideAccess(NOW, S, NOW - GRACE_MS + 1, { kind: 'unreachable' }).allowed).toBe(true)
    expect(decideAccess(NOW, S, NOW - GRACE_MS, { kind: 'unreachable' })).toEqual({
      allowed: false,
      status: 'offline-blocked',
      clearSession: false,
      graceEndsAt: null
    })
  })

  it('servidor caído fuera de gracia o sin validación previa: bloquea sin borrar la sesión', () => {
    expect(decideAccess(NOW, S, NOW - 31 * DAY, { kind: 'unreachable' }).status).toBe('offline-blocked')
    const d = decideAccess(NOW, S, null, { kind: 'unreachable' })
    expect(d.status).toBe('offline-blocked')
    expect(d.clearSession).toBe(false)
  })

  it('5xx, 429 y otros 4xx cuentan como servidor que no responde (no como sesión inválida)', () => {
    for (const status of [500, 502, 503, 429, 403, 400]) {
      expect(decideAccess(NOW, S, NOW - DAY, { kind: 'http', status }).status).toBe('grace')
      expect(decideAccess(NOW, S, NOW - 40 * DAY, { kind: 'http', status }).status).toBe('offline-blocked')
    }
  })

  it('reloj atrasado (validación «del futuro»): bloquea; una holgura pequeña se tolera', () => {
    expect(decideAccess(NOW, S, NOW + CLOCK_SKEW_MS + 1, { kind: 'unreachable' }).status).toBe('offline-blocked')
    expect(decideAccess(NOW, S, NOW + CLOCK_SKEW_MS, { kind: 'unreachable' }).status).toBe('grace')
  })

  it('validación no finita: bloquea', () => {
    expect(decideAccess(NOW, S, Number.NaN, { kind: 'unreachable' }).status).toBe('offline-blocked')
  })
})

describe('accountReducer', () => {
  const on: AccountState = { ...INITIAL_ACCOUNT_STATE, required: true }

  it('config y memory-only', () => {
    expect(accountReducer(INITIAL_ACCOUNT_STATE, { type: 'config', required: true }).required).toBe(true)
    expect(accountReducer(on, { type: 'memory-only', value: true }).memoryOnly).toBe(true)
  })

  it('signing-in → cancel vuelve a signed-out; cancel no pisa otros estados', () => {
    const s1 = accountReducer(on, { type: 'signing-in' })
    expect(s1.status).toBe('signing-in')
    expect(accountReducer(s1, { type: 'cancel' }).status).toBe('signed-out')
    const exp = accountReducer(on, {
      type: 'decision',
      decision: { allowed: false, status: 'expired', clearSession: true, graceEndsAt: null },
      email: 'a@b.cl',
      provider: 'email'
    })
    expect(accountReducer(exp, { type: 'cancel' }).status).toBe('expired')
  })

  it('signed-in guarda correo y proveedor', () => {
    const s = accountReducer({ ...on, checking: true }, { type: 'signed-in', email: 'a@b.cl', provider: 'google' })
    expect(s).toMatchObject({ status: 'signed-in', email: 'a@b.cl', provider: 'google', checking: false, graceEndsAt: null })
  })

  it('decision de gracia conserva correo y fija graceEndsAt; expirada/borrada los limpia', () => {
    const g = accountReducer(on, {
      type: 'decision',
      decision: { allowed: true, status: 'grace', clearSession: false, graceEndsAt: 123 },
      email: 'a@b.cl',
      provider: 'email'
    })
    expect(g).toMatchObject({ status: 'grace', email: 'a@b.cl', graceEndsAt: 123 })
    const d = accountReducer(g, {
      type: 'decision',
      decision: { allowed: false, status: 'deleted', clearSession: true, graceEndsAt: null },
      email: 'a@b.cl',
      provider: 'email'
    })
    expect(d).toMatchObject({ status: 'deleted', email: null, provider: null, graceEndsAt: null })
  })

  it('offline-blocked conserva el correo (la pantalla puede decir «sesión de a@b.cl»)', () => {
    const d = accountReducer(on, {
      type: 'decision',
      decision: { allowed: false, status: 'offline-blocked', clearSession: false, graceEndsAt: null },
      email: 'a@b.cl',
      provider: 'email'
    })
    expect(d.email).toBe('a@b.cl')
  })

  it('signed-out limpia todo', () => {
    const s = accountReducer({ ...on, status: 'signed-in', email: 'a@b.cl', provider: 'email' }, { type: 'signed-out' })
    expect(s).toMatchObject({ status: 'signed-out', email: null, provider: null })
  })

  it('el estado público no tiene campo de token', () => {
    expect(Object.keys(INITIAL_ACCOUNT_STATE).some((k) => /token/i.test(k))).toBe(false)
  })
})

describe('isAccessOpen', () => {
  const base = { required: true, checking: false }
  it('sin cuenta exigida siempre abre', () => {
    expect(isAccessOpen({ required: false, status: 'signed-out', checking: false })).toBe(true)
  })
  it.each([
    ['signed-in', true],
    ['grace', true],
    ['signed-out', false],
    ['signing-in', false],
    ['expired', false],
    ['deleted', false],
    ['offline-blocked', false]
  ] as const)('%s → %s', (status, open) => {
    expect(isAccessOpen({ ...base, status })).toBe(open)
  })
  it('mientras valida la sesión guardada no abre', () => {
    expect(isAccessOpen({ required: true, status: 'signed-in', checking: true })).toBe(false)
  })
})

describe('validación de correo y código', () => {
  it.each(['a@b.cl', 'ana.perez+x@sub.dominio.com', 'A@B.CL', ' a@b.cl ', "o'brien@ejemplo.org", 'x@xn--bcher-kva.example'])(
    'correo válido: %s',
    (e) => {
      expect(isValidEmail(e)).toBe(true)
    }
  )

  it.each([
    '',
    'a',
    'a@',
    '@b.cl',
    'a@b',
    'a b@c.cl',
    'a@b..cl',
    '.a@b.cl',
    'a.@b.cl',
    'a..b@c.cl',
    'a@@b.cl',
    'a@b.c',
    'a@-b.cl',
    '<a>@b.cl',
    'a,b@c.cl',
    'a@b.cl\nb@c.cl'
  ])('correo inválido: %j', (e) => {
    expect(isValidEmail(e)).toBe(false)
  })

  it('máximo 254 caracteres y parte local ≤ 64', () => {
    const tail = '@' + 'd'.repeat(60) + '.' + 'e'.repeat(60) + '.' + 'f'.repeat(60) + '.cl'
    const ok = 'a'.repeat(254 - tail.length) + tail
    expect(ok.length).toBe(254)
    expect(isValidEmail('a'.repeat(64) + '@b.cl')).toBe(true)
    expect(isValidEmail('a'.repeat(65) + '@b.cl')).toBe(false)
    expect(isValidEmail('a'.repeat(255 - tail.length) + tail)).toBe(false)
  })

  it('normalizeEmail recorta y pasa a minúsculas', () => {
    expect(normalizeEmail('  Ana@Ejemplo.CL ')).toBe('ana@ejemplo.cl')
  })

  it('código: exactamente 6 dígitos', () => {
    expect(isValidCode('123456')).toBe(true)
    expect(isValidCode('000000')).toBe(true)
    for (const c of ['', '12345', '1234567', '12345a', '12 456', ' 123456', '123456\n', '١٢٣٤٥٦']) expect(isValidCode(c)).toBe(false)
  })

  it('cleanCodeInput deja solo dígitos y corta a 6', () => {
    expect(cleanCodeInput('12 34-56')).toBe('123456')
    expect(cleanCodeInput('1234567890')).toBe('123456')
    expect(cleanCodeInput('abc')).toBe('')
  })
})
