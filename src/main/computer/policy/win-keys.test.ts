import { describe, expect, it } from 'vitest'
import { WIN_STOP_SHORTCUT, checkCombo, checkKeys, parseCombo } from './win-keys'

describe('parseCombo', () => {
  it.each([
    ['Ctrl+Shift+T', ['ctrl', 'shift'], 't'],
    ['control+ALT+delete', ['ctrl', 'alt'], 'del'],
    ['shift+esc', ['shift'], 'escape'],
    ['alt+F4', ['alt'], 'f4'],
    ['win', ['win'], ''],
    ['super+e', ['win'], 'e'],
    ['ctrl++', ['ctrl'], '+'],
    ['enter', [], 'enter']
  ])('%s', (raw, mods, key) => {
    const p = parseCombo(raw)
    expect(p && [p.mods, p.key]).toEqual([mods, key])
  })
  it.each(['', '   ', '+ctrl', 'ctrl+', 'ctrl++a', 'ctrl+nopekey', 'a+b', 'x'.repeat(65)])('no válida: «%s»', (raw) => {
    expect(parseCombo(raw)).toBeNull()
  })
})

describe('checkCombo: tabla de rechazos', () => {
  const rows: Array<[string, string, Record<string, unknown>?]> = [
    ['win+r', 'blocked'],
    ['Win+R', 'blocked'],
    ['lwin+r', 'blocked'],
    ['win+x', 'blocked'],
    ['win+l', 'blocked'],
    ['ctrl+shift+esc', 'blocked'],
    ['ctrl+shift+escape', 'blocked'],
    ['shift+control+esc', 'blocked'],
    ['ctrl+alt+del', 'blocked'],
    ['ctrl+alt+delete', 'blocked'],
    ['alt+f4', 'foreground', { lazunoxFrontmost: true }],
    ['ctrl+w', 'foreground', { lazunoxFrontmost: true }],
    [WIN_STOP_SHORTCUT, 'stop'],
    ['ctrl+alt+shift+esc', 'stop'],
    ['ctrl+alt+pause', 'stop', { stopShortcut: 'ctrl+alt+pause' }],
    ['win+tab', 'win'],
    ['win+shift+s', 'win'],
    ['win+ctrl+d', 'win'],
    ['win+1', 'win'],
    ['win', 'win'],
    ['cmd+c', 'cmd'],
    ['command+shift+t', 'cmd'],
    ['ctrl+cmd+v', 'cmd'],
    ['fn+f1', 'invalid'],
    ['', 'invalid']
  ]
  it.each(rows)('%s -> %s', (combo, code, ctx) => {
    const v = checkCombo(combo, ctx)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe(code)
  })
  it('cmd/command: «En Windows usa ctrl»', () => {
    const v = checkCombo('cmd+c')
    expect(!v.ok && v.reason).toBe('En Windows usa ctrl')
  })
})

describe('checkCombo: tabla de aceptadas', () => {
  it.each([
    ['win+d', 'win+d'],
    ['win+e', 'win+e'],
    ['WIN+S', 'win+s'],
    ['ctrl+c', 'ctrl+c'],
    ['shift+ctrl+t', 'ctrl+shift+t'],
    ['alt+tab', 'alt+tab'],
    ['alt+f4', 'alt+f4'],
    ['ctrl+w', 'ctrl+w'],
    ['enter', 'enter'],
    ['f5', 'f5'],
    ['ctrl+alt+shift+t', 'ctrl+alt+shift+t']
  ])('%s', (raw, combo) => {
    expect(checkCombo(raw, { lazunoxFrontmost: false })).toEqual({ ok: true, combo })
  })
  it('alt+f4 y ctrl+w con Lazunox fuera de primer plano sí pasan; con otra tecla de Lazunox, también', () => {
    expect(checkCombo('ctrl+w', { lazunoxFrontmost: true }).ok).toBe(false)
    expect(checkCombo('ctrl+shift+w', { lazunoxFrontmost: true }).ok).toBe(true)
  })
})

describe('checkKeys', () => {
  it('varias combinaciones separadas por espacios; la primera rechazada corta', () => {
    expect(checkKeys('ctrl+a ctrl+c')).toEqual({ ok: true, combos: ['ctrl+a', 'ctrl+c'] })
    const v = checkKeys('ctrl+a win+r ctrl+c')
    expect(!v.ok && v.combo).toBe('win+r')
  })
  it('vacío o demasiadas combinaciones', () => {
    expect(checkKeys('   ').ok).toBe(false)
    expect(checkKeys(Array(17).fill('a').join(' ')).ok).toBe(false)
  })
})

describe('barrido exhaustivo de modificadores x teclas', () => {
  const MODS = ['ctrl', 'alt', 'shift', 'win', 'cmd']
  const KEYS = ['a', 'c', 'd', 'e', 'l', 'r', 's', 'w', 'x', 'f4', 'del', 'esc', 'escape', 'tab', 'enter', '1']
  const subsets: string[][] = []
  for (let m = 0; m < 1 << MODS.length; m++) subsets.push(MODS.filter((_, i) => m & (1 << i)))
  const all = subsets.flatMap((mods) => KEYS.map((k) => [...mods, k].join('+')))

  it('invariantes sobre todas las combinaciones', () => {
    expect(all.length).toBe(32 * KEYS.length)
    for (const combo of all) {
      for (const front of [false, true]) {
        const v = checkCombo(combo, { lazunoxFrontmost: front })
        const p = parseCombo(combo)!
        const key = p.key
        if (combo.split('+').some((t) => t === 'cmd')) {
          expect(v.ok, combo).toBe(false)
          continue
        }
        if (p.mods.includes('win')) {
          const allowed = p.mods.length === 1 && ['d', 'e', 's'].includes(key)
          expect(v.ok, combo).toBe(allowed)
          continue
        }
        const m = p.mods.join('+')
        const forbidden =
          (m === 'ctrl+alt' && key === 'del') ||
          (m === 'ctrl+shift' && key === 'escape') ||
          (m === 'ctrl+alt+shift' && key === 'escape') ||
          (front && ((m === 'alt' && key === 'f4') || (m === 'ctrl' && key === 'w')))
        expect(v.ok, `${combo} front=${front}`).toBe(!forbidden)
      }
    }
  })
})
