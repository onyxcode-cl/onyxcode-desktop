import { describe, expect, it } from 'vitest'
import { fitTextarea, isImeComposing, isSubmitKey, type KeyEventLike } from './textarea'

const ev = (o: Partial<Omit<KeyEventLike, 'nativeEvent'>> & { isComposing?: boolean } = {}): KeyEventLike => ({
  key: o.key ?? 'Enter',
  shiftKey: o.shiftKey ?? false,
  keyCode: o.keyCode ?? 13,
  nativeEvent: { isComposing: o.isComposing ?? false }
})

describe('isSubmitKey', () => {
  it('Enter simple envía', () => expect(isSubmitKey(ev())).toBe(true))
  it('otra tecla no envía', () => expect(isSubmitKey(ev({ key: 'a' }))).toBe(false))
  it('Shift+Enter no envía', () => expect(isSubmitKey(ev({ shiftKey: true }))).toBe(false))
  it('Shift+Enter con allowShift envía', () => expect(isSubmitKey(ev({ shiftKey: true }), { allowShift: true })).toBe(true))
  it('isComposing bloquea (también con allowShift)', () => {
    expect(isSubmitKey(ev({ isComposing: true }))).toBe(false)
    expect(isSubmitKey(ev({ isComposing: true }), { allowShift: true })).toBe(false)
  })
  it('keyCode 229 (Enter tras compositionend) bloquea (F6-B7)', () => {
    expect(isSubmitKey(ev({ keyCode: 229 }))).toBe(false)
    expect(isImeComposing(ev({ keyCode: 229 }))).toBe(true)
  })
})

describe('fitTextarea', () => {
  const fake = (scrollHeight: number): HTMLTextAreaElement =>
    ({ scrollHeight, style: { height: '', overflowY: '' } }) as unknown as HTMLTextAreaElement

  it('usa el scrollHeight si no llega al tope', () => {
    const el = fake(100)
    fitTextarea(el, 260)
    expect(el.style.height).toBe('100px')
    expect(el.style.overflowY).toBe('')
  })
  it('recorta al tope', () => {
    const el = fake(500)
    fitTextarea(el, 260)
    expect(el.style.height).toBe('260px')
  })
  it('manageOverflow alterna overflowY', () => {
    const a = fake(500)
    fitTextarea(a, 280, true)
    expect(a.style.overflowY).toBe('auto')
    const b = fake(100)
    fitTextarea(b, 280, true)
    expect(b.style.overflowY).toBe('hidden')
  })
})
