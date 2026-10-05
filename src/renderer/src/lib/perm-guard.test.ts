import { describe, expect, it } from 'vitest'
import { ARM_MS, MAX_DRIFT_PX, armState, decidePermKey, initialArmState, type PermKeyContext, type PermKeyEvent } from './perm-guard'

const ev = (over: Partial<PermKeyEvent> = {}): PermKeyEvent => ({
  key: 'Enter',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  isComposing: false,
  targetIsNote: false,
  targetIsPermit: false,
  ...over
})

const ctx = (over: Partial<PermKeyContext> = {}): PermKeyContext => ({
  mac: true,
  focusInCard: true,
  windowFocused: true,
  visible: true,
  armed: true,
  busy: false,
  observing: true,
  ...over
})

describe('decidePermKey: teclado seguro', () => {
  it('Enter sin modificador sobre «Permitir» → block-enter (nunca permite)', () => {
    expect(decidePermKey(ev({ key: 'Enter', targetIsPermit: true }), ctx())).toBe('block-enter')
    expect(decidePermKey(ev({ key: 'Enter', targetIsPermit: false }), ctx())).toBe('none')
  })

  it('⌘↵ con todo verde en mac → once', () => {
    expect(decidePermKey(ev({ key: 'Enter', metaKey: true }), ctx())).toBe('once')
  })

  it('Ctrl+↵ en mac → none; en Windows → once', () => {
    expect(decidePermKey(ev({ key: 'Enter', ctrlKey: true }), ctx({ mac: true }))).toBe('none')
    expect(decidePermKey(ev({ key: 'Enter', ctrlKey: true }), ctx({ mac: false }))).toBe('once')
  })

  it.each([
    ['focusInCard', { focusInCard: false }],
    ['windowFocused', { windowFocused: false }],
    ['visible', { visible: false }],
    ['armed', { armed: false }],
    ['busy', { busy: true }],
    ['observing', { observing: false }]
  ] as const)('⌘↵ con %s en falso → none', (_name, over) => {
    expect(decidePermKey(ev({ key: 'Enter', metaKey: true }), ctx(over))).toBe('none')
  })

  it.each([
    ['repeat', { repeat: true }],
    ['isComposing', { isComposing: true }],
    ['Alt', { altKey: true }],
    ['Shift', { shiftKey: true }]
  ] as const)('⌘↵ con %s activo → none', (_name, over) => {
    expect(decidePermKey(ev({ key: 'Enter', metaKey: true, ...over }), ctx())).toBe('none')
  })

  it('Escape → reject con foco en la tarjeta; en la nota → none', () => {
    expect(decidePermKey(ev({ key: 'Escape' }), ctx({ focusInCard: true }))).toBe('reject')
    expect(decidePermKey(ev({ key: 'Escape' }), ctx({ focusInCard: false }))).toBe('none')
    expect(decidePermKey(ev({ key: 'Escape', targetIsNote: true }), ctx())).toBe('none')
  })

  it('⌘↵ en la textarea de indicaciones → none (nunca permite)', () => {
    expect(decidePermKey(ev({ key: 'Enter', metaKey: true, targetIsNote: true }), ctx())).toBe('none')
  })

  it('nunca se devuelve «always» (barrido de teclas y modificadores)', () => {
    const keys = ['Enter', 'Escape', '1', '2', '3', 'a', ' ', 'ArrowDown']
    const mods: Array<Partial<PermKeyEvent>> = [
      {},
      { metaKey: true },
      { ctrlKey: true },
      { altKey: true },
      { shiftKey: true },
      { metaKey: true, shiftKey: true },
      { repeat: true }
    ]
    for (const key of keys) {
      for (const m of mods) {
        for (const targetIsPermit of [false, true]) {
          expect(decidePermKey(ev({ key, targetIsPermit, ...m }), ctx())).not.toBe('always')
        }
      }
    }
  })
})

describe('armState: 600 ms de visibilidad continua', () => {
  it('menos de 600 ms no arma', () => {
    const s = initialArmState(0, 0)
    expect(armState(s, { visible: true, now: ARM_MS - 1, y: 0 }).armed).toBe(false)
  })

  it('a los 600 ms arma', () => {
    const s = initialArmState(0, 0)
    expect(armState(s, { visible: true, now: ARM_MS, y: 0 }).armed).toBe(true)
  })

  it('al ocultarse se desarma y reinicia el reloj', () => {
    const s = armState(initialArmState(0, 0), { visible: true, now: ARM_MS, y: 0 })
    expect(s.armed).toBe(true)
    const hidden = armState(s, { visible: false, now: ARM_MS + 50, y: 0 })
    expect(hidden.armed).toBe(false)
    expect(hidden.since).toBe(ARM_MS + 50)
  })

  it('se desarma si el contenedor se desplaza más de 24 px', () => {
    const s = armState(initialArmState(0, 0), { visible: true, now: ARM_MS, y: 0 })
    expect(s.armed).toBe(true)
    expect(armState(s, { visible: true, now: ARM_MS + 10, y: MAX_DRIFT_PX }).armed).toBe(true)
    expect(armState(s, { visible: true, now: ARM_MS + 10, y: MAX_DRIFT_PX + 1 }).armed).toBe(false)
  })

  it('sin observador el teclado no arma (⌘↵ desactivado) pero el clic arma por tiempo', () => {
    // Teclado: decidePermKey con observing=false nunca devuelve 'once'.
    expect(decidePermKey(ev({ key: 'Enter', metaKey: true }), ctx({ observing: false }))).toBe('none')
    // Clic: armState sigue armando por tiempo (el clic pasa visible=true).
    const s = armState(initialArmState(0, 0), { visible: true, now: ARM_MS, y: 0 })
    expect(s.armed).toBe(true)
  })
})
