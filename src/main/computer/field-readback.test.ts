import { describe, expect, it } from 'vitest'
import { keyFieldChange, pickFocusedField, pressNotAnnounced, pressPrecheck, typedProgress, type FocusedField } from './field-readback'

const f = (value: string, o: Partial<FocusedField> = {}): FocusedField => ({
  ref: 'w0.1',
  role: 'AXTextField',
  secure: false,
  value,
  underWebArea: false,
  ...o
})

describe('pickFocusedField', () => {
  it('elige el campo editable con foco más profundo e ignora textos estáticos y elementos sin foco', () => {
    const got = pickFocusedField([
      { ref: 'w0', role: 'AXWindow', focused: true },
      { ref: 'w0.1', role: 'AXTextArea', focused: true, value: 'a' },
      { ref: 'w0.1.3', role: 'AXTextField', focused: true, value: 'hola' },
      { ref: 'w0.2', role: 'AXStaticText', focused: true, value: 'x' },
      { ref: 'w0.4', role: 'AXTextField', focused: false, value: 'no' }
    ])
    expect(got?.ref).toBe('w0.1.3')
    expect(got?.value).toBe('hola')
  })

  it('un campo seguro NUNCA conserva su valor, aunque el árbol lo trajera', () => {
    const got = pickFocusedField([{ ref: 'w0.1', role: 'AXTextField', subrole: 'AXSecureTextField', focused: true, value: 'secreto' }])
    expect(got?.secure).toBe(true)
    expect(got?.value).toBe('')
    expect(pickFocusedField([{ ref: 'w0.1', role: 'Edit', secure: true, focused: true, value: 'secreto' }])?.value).toBe('')
  })

  it('marca si cuelga de una vista web y vale vacío cuando no hay atributo de valor (Windows)', () => {
    const got = pickFocusedField([
      { ref: 'w0.2', role: 'AXWebArea' },
      { ref: 'w0.2.5.1', role: 'AXTextArea', focused: true }
    ])
    expect(got).toMatchObject({ underWebArea: true, value: '' })
    // `w0.20` NO es hijo de `w0.2`.
    expect(
      pickFocusedField([
        { ref: 'w0.2', role: 'AXWebArea' },
        { ref: 'w0.20', role: 'Edit', focused: true }
      ])?.underWebArea
    ).toBe(false)
  })

  it('sin campo editable con foco ⇒ null', () => {
    expect(pickFocusedField([{ ref: 'w0.1', role: 'AXButton', focused: true }])).toBeNull()
    expect(pickFocusedField([])).toBeNull()
  })
})

describe('typedProgress', () => {
  it('el texto aparece más veces que antes ⇒ complete', () => {
    expect(typedProgress('hola mundo', f(''), f('hola mundo'))).toEqual({ kind: 'complete' })
    expect(typedProgress('ab', f('xx'), f('xxab'))).toEqual({ kind: 'complete' })
  })

  it('el texto YA estaba y el campo no cambió ⇒ unchanged (no confirma)', () => {
    expect(typedProgress('hola', f('hola'), f('hola'))).toEqual({ kind: 'unchanged' })
  })

  it('solo llegó el comienzo ⇒ partial con las cuentas', () => {
    expect(typedProgress('hola mundo', f(''), f('hola'))).toEqual({ kind: 'partial', typed: 4, total: 10 })
  })

  it('el campo no cambió ⇒ unchanged', () => {
    expect(typedProgress('hola', f('abc'), f('abc'))).toEqual({ kind: 'unchanged' })
  })

  it('cambió pero no coincide (la app transforma el texto) ⇒ unverifiable, no partial', () => {
    expect(typedProgress('hola', f('abc'), f('XYZ'))).toMatchObject({ kind: 'unverifiable' })
  })

  it('mayúsculas distintas NO confirman', () => {
    expect(typedProgress('ABC123', f(''), f('abc123'))).toMatchObject({ kind: 'unverifiable' })
  })

  it('campo seguro, foco en otro campo o falta una lectura ⇒ unverifiable', () => {
    expect(typedProgress('hola', f('', { secure: true }), f('hola'))).toMatchObject({ kind: 'unverifiable' })
    expect(typedProgress('hola', f(''), f('hola', { ref: 'w0.9' }))).toMatchObject({ kind: 'unverifiable' })
    expect(typedProgress('hola', f(''), f('hola', { role: 'AXTextArea' }))).toMatchObject({ kind: 'unverifiable' })
    expect(typedProgress('hola', null, f('hola'))).toMatchObject({ kind: 'unverifiable' })
    expect(typedProgress('hola', f(''), null)).toMatchObject({ kind: 'unverifiable' })
  })

  it('texto terminado en Return: si no se ve completo no se acusa de nada (pudo enviarse y vaciarse)', () => {
    expect(typedProgress('hola\n', f('hola'), f(''))).toMatchObject({ kind: 'unverifiable' })
    expect(typedProgress('hola\n', f(''), f('hola'))).toEqual({ kind: 'complete' })
  })

  it('valor recortado a 200: si no se ve completo no se niega', () => {
    const big = 'x'.repeat(200)
    expect(typedProgress('hola', f(big), f(big))).toMatchObject({ kind: 'unverifiable' })
  })

  it('bajo una vista web solo se CONFIRMA: sin cambio o parcial no se afirma nada (valor con retraso o eco)', () => {
    expect(typedProgress('hola', f('', { underWebArea: true }), f('', { underWebArea: true }))).toMatchObject({ kind: 'unverifiable' })
    expect(typedProgress('hola', f('', { underWebArea: true }), f('ho', { underWebArea: true }))).toMatchObject({ kind: 'unverifiable' })
    expect(typedProgress('hola', f('', { underWebArea: true }), f('hola', { underWebArea: true }))).toEqual({ kind: 'complete' })
  })
})

describe('keyFieldChange', () => {
  it('solo el cambio de valor del MISMO campo es evidencia', () => {
    expect(keyFieldChange(f('ab'), f('a'))).toBe('changed')
    expect(keyFieldChange(f('ab'), f('ab'))).toBe('unknown')
    expect(keyFieldChange(f('ab'), f('a', { ref: 'w0.7' }))).toBe('unknown')
    expect(keyFieldChange(f('ab'), null)).toBe('unknown')
    expect(keyFieldChange(null, f('a'))).toBe('unknown')
    expect(keyFieldChange(f('', { secure: true }), f('a'))).toBe('unknown')
  })
})

describe('pressPrecheck / pressNotAnnounced', () => {
  it('deshabilitado ⇒ rechazo con código estable; habilitado, desconocido o sin lectura ⇒ pasa', () => {
    const bad = pressPrecheck({ enabled: false }, 'w0.2.1')
    expect(bad).toMatchObject({ ok: false, code: 'disabled' })
    expect(bad.ok === false && bad.message).toContain('w0.2.1')
    expect(pressPrecheck({ enabled: true }, 'w0.2.1')).toEqual({ ok: true })
    expect(pressPrecheck({}, 'w0.2.1')).toEqual({ ok: true })
    expect(pressPrecheck(null, 'w0.2.1')).toEqual({ ok: true })
  })

  it('pulsación hueca: solo si el elemento publica acciones y no incluye AXPress', () => {
    expect(pressNotAnnounced(['AXShowMenu'])).toBe(true)
    expect(pressNotAnnounced([])).toBe(true)
    expect(pressNotAnnounced(['AXPress'])).toBe(false)
    expect(pressNotAnnounced(undefined)).toBe(false)
  })
})
