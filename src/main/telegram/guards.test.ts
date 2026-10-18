import { describe, expect, it } from 'vitest'
import { ButtonBook, LinkCode, MinuteLimiter } from './guards'

describe('LinkCode', () => {
  const mk = (clock: { t: number }) =>
    new LinkCode(
      () => clock.t,
      { ttlMs: 600_000, maxAttempts: 5, lockMs: 900_000 },
      () => '654321'
    )

  it('es de 6 dígitos con el generador real', () => {
    const c = new LinkCode()
    for (let i = 0; i < 50; i++) expect(c.issue()).toMatch(/^\d{6}$/)
  })

  it('acierta una vez y se consume', () => {
    const clock = { t: 1000 }
    const c = mk(clock)
    c.issue()
    expect(c.check(' 654321 ').ok).toBe(true)
    expect(c.check('654321')).toMatchObject({ ok: false, reason: 'none' })
  })

  it('caduca a los 10 minutos', () => {
    const clock = { t: 0 }
    const c = mk(clock)
    c.issue()
    clock.t = 599_999
    expect(c.current()).not.toBeNull()
    clock.t = 600_000
    expect(c.current()).toBeNull()
    expect(c.check('654321')).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('5 fallos bloquean 15 minutos, invalidan el código y no dejan pedir otro hasta que pase', () => {
    const clock = { t: 0 }
    const c = mk(clock)
    c.issue()
    for (let i = 0; i < 4; i++) expect(c.check('000000')).toMatchObject({ reason: 'wrong', attemptsLeft: 4 - i })
    expect(c.check('000000')).toMatchObject({ reason: 'locked' })
    expect(c.check('654321')).toMatchObject({ ok: false, reason: 'locked' })
    expect(c.issue()).toBeNull()
    clock.t = 900_000
    expect(c.issue()).toBe('654321')
    expect(c.check('654321').ok).toBe(true)
  })

  it('un código vacío o de otro largo nunca coincide', () => {
    const clock = { t: 0 }
    const c = mk(clock)
    c.issue()
    for (const bad of ['', '65432', '6543210', 'abcdef', '65432１']) expect(c.check(bad).ok).toBe(false)
  })
})

describe('MinuteLimiter', () => {
  it('admite N por minuto y libera al pasar la ventana', () => {
    const clock = { t: 0 }
    const l = new MinuteLimiter(3, () => clock.t)
    expect([l.take(), l.take(), l.take(), l.take()]).toEqual([true, true, true, false])
    clock.t = 60_001
    expect(l.take()).toBe(true)
  })
})

describe('ButtonBook', () => {
  it('identificadores cortos y aleatorios; callback_data cabe holgado en 64 bytes', () => {
    const b = new ButtonBook()
    const ids = new Set<string>()
    for (let i = 0; i < 100; i++) {
      const e = b.create(`per_${i}`, 1)
      ids.add(e.id)
      expect(Buffer.byteLength(ButtonBook.data(e, 'a'))).toBeLessThanOrEqual(20)
      expect(e.id).toMatch(/^[A-Za-z0-9_-]{12}$/)
    }
    expect(ids.size).toBe(100)
  })

  it('un permiso tiene un solo identificador', () => {
    const b = new ButtonBook()
    expect(b.create('p', 1).id).toBe(b.create('p', 1).id)
  })

  it('solo vale para el chat dueño, una vez, y mientras no caduque', () => {
    const clock = { t: 0 }
    const b = new ButtonBook(() => clock.t, 1000)
    const e = b.create('p', 7)
    const d = ButtonBook.data(e, 'r')
    expect(b.take(d, 8)).toMatchObject({ ok: false, reason: 'wrong-chat' })
    const first = b.take(d, 7)
    expect(first).toMatchObject({ ok: true, action: 'r' })
    expect(b.take(d, 7)).toMatchObject({ ok: false, reason: 'used' })
    b.release(e.id)
    expect(b.take(d, 7).ok).toBe(true)
    b.release(e.id)
    clock.t = 1000
    expect(b.take(d, 7)).toMatchObject({ ok: false, reason: 'expired' })
  })

  it('rechaza datos mal formados o desconocidos', () => {
    const b = new ButtonBook()
    for (const d of [undefined, '', 'p:x:a', 'p:AAAAAAAAAAAA:q', 'q:AAAAAAAAAAAA:a', 'p:AAAAAAAAAAAA:a:extra'])
      expect(b.take(d, 1).ok).toBe(false)
    expect(b.take('p:AAAAAAAAAAAA:a', 1)).toMatchObject({ reason: 'unknown' })
  })

  it('retirar un permiso gasta sus botones y recuerda quién lo cerró', () => {
    const b = new ButtonBook()
    const e = b.create('p', 1)
    b.retire('p', 'screen')
    expect(b.take(ButtonBook.data(e, 'a'), 1)).toMatchObject({ ok: false, reason: 'used', entry: { by: 'screen' } })
  })

  it('no crece sin límite', () => {
    const b = new ButtonBook(Date.now, 1000, 50)
    for (let i = 0; i < 500; i++) b.create(`p${i}`, 1)
    expect(b.size).toBeLessThanOrEqual(50)
  })
})
