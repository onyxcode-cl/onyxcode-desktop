import { describe, expect, it } from 'vitest'
import {
  ACTIONS,
  ACTIONS_BY_ID,
  actionsFor,
  allowedAtFocus,
  bindingDisplay,
  defaultBindingOf,
  effectiveBindings,
  eventToBinding,
  findConflicts,
  hasStrongModifier,
  isCustomized,
  normalizeBinding,
  reservedFor,
  sanitizeOverrides,
  validateBinding,
  withBinding,
  withDisabled,
  withReset,
  type KeyEventLike
} from './keybindings'
import { DICTIONARIES } from './i18n'

const ev = (over: Partial<KeyEventLike> & Pick<KeyEventLike, 'key' | 'code'>): KeyEventLike => ({
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over
})

describe('normalizeBinding', () => {
  it('forma normalizada y orden fijo de modificadores', () => {
    expect(normalizeBinding('Shift+Mod+p', 'mac')).toBe('Mod+Shift+P')
    expect(normalizeBinding('CommandOrControl+K', 'win')).toBe('Mod+K')
    expect(normalizeBinding('Command+Shift+Space', 'mac')).toBe('Mod+Shift+Space')
    expect(normalizeBinding('Alt+Option+Return', 'mac')).toBe('Alt+Enter')
  })
  it('Ctrl es el Control literal solo en macOS; en Windows/Linux equivale a Mod', () => {
    expect(normalizeBinding('Ctrl+Tab', 'mac')).toBe('Ctrl+Tab')
    expect(normalizeBinding('Ctrl+Tab', 'win')).toBe('Mod+Tab')
    expect(normalizeBinding('Control+Alt+K', 'linux')).toBe('Mod+Alt+K')
  })
  it('la tecla Windows/Super no es un modificador válido fuera de macOS', () => {
    expect(normalizeBinding('Super+K', 'win')).toBeNull()
    expect(normalizeBinding('Cmd+K', 'linux')).toBeNull()
    expect(normalizeBinding('Super+K', 'mac')).toBe('Mod+K')
  })
  it('signos de puntuación, + y teclas de función', () => {
    expect(normalizeBinding('Mod+\\', 'mac')).toBe('Mod+\\')
    expect(normalizeBinding('Mod+,', 'mac')).toBe('Mod+,')
    expect(normalizeBinding('Mod++', 'mac')).toBe('Mod+Plus')
    expect(normalizeBinding('f5', 'win')).toBe('F5')
    expect(normalizeBinding('Mod+F13', 'win')).toBeNull()
  })
  it('rechaza basura', () => {
    for (const bad of ['', '   ', 'Mod+', 'Hyper+K', 'Mod+Ñ', 'Mod+KK', 'x'.repeat(80)]) expect(normalizeBinding(bad, 'mac')).toBeNull()
    expect(normalizeBinding(5 as unknown as string, 'mac')).toBeNull()
  })
  it('es idempotente', () => {
    for (const a of ACTIONS) {
      const d = defaultBindingOf(a, 'mac')
      if (d) expect(normalizeBinding(d, 'mac')).toBe(d)
      const w = defaultBindingOf(a, 'win')
      if (w) expect(normalizeBinding(w, 'win')).toBe(w)
    }
  })
})

describe('eventToBinding', () => {
  it('Cmd+K en macOS / Ctrl+K en Windows → Mod+K', () => {
    expect(eventToBinding(ev({ key: 'k', code: 'KeyK', metaKey: true }), 'mac')).toBe('Mod+K')
    expect(eventToBinding(ev({ key: 'k', code: 'KeyK', ctrlKey: true }), 'win')).toBe('Mod+K')
    expect(eventToBinding(ev({ key: 'p', code: 'KeyP', metaKey: true, shiftKey: true }), 'mac')).toBe('Mod+Shift+P')
  })
  it('Ctrl literal en macOS se distingue de Cmd; la tecla Windows no es atajo en Windows', () => {
    expect(eventToBinding(ev({ key: 'Tab', code: 'Tab', ctrlKey: true }), 'mac')).toBe('Ctrl+Tab')
    expect(eventToBinding(ev({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true }), 'win')).toBe('Mod+Shift+Tab')
    expect(eventToBinding(ev({ key: 'k', code: 'KeyK', metaKey: true }), 'win')).toBeNull()
  })
  it('los dígitos usan el código físico (Shift+1 sigue siendo 1)', () => {
    expect(eventToBinding(ev({ key: '!', code: 'Digit1', metaKey: true, shiftKey: true }), 'mac')).toBe('Mod+Shift+1')
    expect(eventToBinding(ev({ key: '4', code: 'Digit4', ctrlKey: true }), 'win')).toBe('Mod+4')
  })
  it('teclado español: ç/ñ y signos no ASCII caen a la tecla física; la coma y el punto siguen siendo carácter', () => {
    expect(eventToBinding(ev({ key: 'ç', code: 'Backslash', metaKey: true }), 'mac')).toBe('Mod+\\')
    expect(eventToBinding(ev({ key: ',', code: 'Comma', ctrlKey: true }), 'win')).toBe('Mod+,')
    expect(eventToBinding(ev({ key: '-', code: 'Slash', ctrlKey: true }), 'win')).toBe('Mod+-')
    expect(eventToBinding(ev({ key: 'ñ', code: 'Semicolon', ctrlKey: true }), 'win')).toBe('Mod+;')
  })
  it('Option en macOS (carácter compuesto) usa la letra física: Alt+K', () => {
    expect(eventToBinding(ev({ key: '˚', code: 'KeyK', altKey: true }), 'mac')).toBe('Alt+K')
  })
  it('AltGr en Windows/Linux (Ctrl+Alt) NO es un atajo, ni con estado AltGraph ni con la tecla reportada', () => {
    const altGr = ev({ key: '@', code: 'Digit2', ctrlKey: true, altKey: true, getModifierState: (k) => k === 'AltGraph' })
    expect(eventToBinding(altGr, 'win')).toBeNull()
    expect(eventToBinding(altGr, 'linux')).toBeNull()
    // Sin AltGr real (teclado US), Ctrl+Alt+K sí es Mod+Alt+K.
    expect(eventToBinding(ev({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true, getModifierState: () => false }), 'win')).toBe(
      'Mod+Alt+K'
    )
  })
  it('IME / composición / teclas muertas / solo modificadores no disparan nada', () => {
    expect(eventToBinding(ev({ key: 'a', code: 'KeyA', ctrlKey: true, isComposing: true }), 'win')).toBeNull()
    expect(eventToBinding(ev({ key: 'Process', code: 'KeyA', keyCode: 229, metaKey: true }), 'mac')).toBeNull()
    expect(eventToBinding(ev({ key: 'a', code: 'KeyA', metaKey: true, keyCode: 229 }), 'mac')).toBeNull()
    expect(eventToBinding(ev({ key: 'Dead', code: 'Quote', altKey: true }), 'mac')).toBeNull()
    expect(eventToBinding(ev({ key: 'Meta', code: 'MetaLeft', metaKey: true }), 'mac')).toBeNull()
    expect(eventToBinding(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), 'win')).toBeNull()
  })
  it('teclas con nombre y de función', () => {
    expect(eventToBinding(ev({ key: 'Escape', code: 'Escape' }), 'mac')).toBe('Escape')
    expect(eventToBinding(ev({ key: 'Tab', code: 'Tab', shiftKey: true }), 'mac')).toBe('Shift+Tab')
    expect(eventToBinding(ev({ key: 'F5', code: 'F5' }), 'win')).toBe('F5')
    expect(eventToBinding(ev({ key: ' ', code: 'Space', altKey: true }), 'win')).toBe('Alt+Space')
  })
  it('Cyrillic u otra distribución no latina: la letra física', () => {
    expect(eventToBinding(ev({ key: 'л', code: 'KeyK', ctrlKey: true }), 'win')).toBe('Mod+K')
  })
})

describe('registro de acciones', () => {
  it('ids únicos, claves i18n existentes en es y en, y atajos por defecto válidos en las tres plataformas', () => {
    const ids = ACTIONS.map((a) => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const a of ACTIONS) {
      expect(DICTIONARIES.es[a.nameKey], a.nameKey).toBeTruthy()
      expect(DICTIONARIES.en[a.nameKey], a.nameKey).toBeTruthy()
      for (const p of ['mac', 'win', 'linux'] as const) {
        if (a.defaultBinding) expect(normalizeBinding(a.defaultBinding, p), `${a.id}/${p}`).not.toBeNull()
      }
    }
  })
  it('por defecto: los atajos de siempre', () => {
    const mac = effectiveBindings({}, 'mac')
    expect(mac).toMatchObject({
      'palette.toggle': 'Mod+K',
      'palette.alt': 'Mod+Shift+P',
      'conversation.new': 'Mod+N',
      'sidebar.toggle': 'Mod+\\',
      'settings.toggle': 'Mod+,',
      'mode.next': 'Ctrl+Tab',
      'mode.prev': 'Ctrl+Shift+Tab',
      'session.stop': 'Escape',
      'code.togglePlanBuild': 'Shift+Tab',
      'code.panel.changes': 'Mod+1',
      'code.panel.terminal': 'Mod+2',
      'code.panel.files': 'Mod+3',
      'code.panel.browser': 'Mod+4'
    })
    expect(effectiveBindings({}, 'win')['mode.next']).toBe('Mod+Tab')
  })
  it('ningún atajo por defecto es una combinación reservada, y sin conflictos propios salvo los exclusivos por diseño', () => {
    for (const p of ['mac', 'win', 'linux'] as const) {
      const eff = effectiveBindings({}, p)
      for (const a of ACTIONS) {
        const b = eff[a.id]
        if (!b) continue
        expect(reservedFor(b, p), `${a.id}/${p}`).toBeNull()
        expect(findConflicts(b, a.id, eff), `${a.id}/${p}`).toEqual([])
      }
    }
  })
  it('⌘K lo comparten palette.toggle y code.sessionSwitcher (excluyentes), pero no cuenta como conflicto', () => {
    const eff = effectiveBindings({}, 'mac')
    expect(actionsFor('Mod+K', eff).map((a) => a.id)).toEqual(['palette.toggle', 'code.sessionSwitcher'])
    expect(findConflicts('Mod+K', 'palette.toggle', eff)).toEqual([])
  })
})

describe('overrides', () => {
  it('un override cambia el atajo, null lo desactiva, uno inválido se ignora', () => {
    const eff = effectiveBindings({ 'mode.chat': 'Mod+Alt+1', 'palette.alt': null, 'sidebar.toggle': 'basura+' }, 'mac')
    expect(eff['mode.chat']).toBe('Mod+Alt+1')
    expect(eff['palette.alt']).toBeNull()
    expect(eff['sidebar.toggle']).toBe('Mod+\\')
  })
  it('normaliza el override según la plataforma (guardado portable)', () => {
    expect(effectiveBindings({ 'mode.chat': 'Control+Alt+1' }, 'win')['mode.chat']).toBe('Mod+Alt+1')
    expect(effectiveBindings({ 'mode.chat': 'Control+Alt+1' }, 'mac')['mode.chat']).toBe('Ctrl+Alt+1')
  })
  it('withBinding / withDisabled / withReset', () => {
    let o = withBinding({}, 'mode.chat', 'Mod+Alt+1', 'mac')
    expect(o).toEqual({ 'mode.chat': 'Mod+Alt+1' })
    expect(isCustomized(o, 'mode.chat')).toBe(true)
    // Asignar el atajo por defecto borra el override.
    o = withBinding(o, 'palette.alt', 'Mod+Shift+P', 'mac')
    expect(o).toEqual({ 'mode.chat': 'Mod+Alt+1' })
    o = withDisabled(o, 'palette.alt', 'mac')
    expect(o['palette.alt']).toBeNull()
    // Desactivar una acción sin atajo por defecto no deja un `null` inútil.
    expect(withDisabled({}, 'mode.chat', 'mac')).toEqual({})
    o = withReset(o, 'palette.alt')
    expect(o).toEqual({ 'mode.chat': 'Mod+Alt+1' })
    // Reasignar: la otra acción cede (null) y nunca recibe otro atajo en silencio.
    expect(withBinding({}, 'mode.chat', 'Mod+N', 'mac', ['conversation.new'])).toEqual({ 'conversation.new': null, 'mode.chat': 'Mod+N' })
  })
  it('no muta la entrada', () => {
    const input = Object.freeze({ 'mode.chat': 'Mod+Alt+1' })
    expect(() => withBinding(input, 'mode.code', 'Mod+Alt+2', 'mac')).not.toThrow()
    expect(() => withReset(input, 'mode.chat')).not.toThrow()
  })
  it('sanitizeOverrides: forma, límite y claves peligrosas', () => {
    const clean = sanitizeOverrides(
      { 'mode.chat': 'Control+Alt+1', 'palette.alt': null, '9malo': 'Mod+K', constructor: 'Mod+K', x: 5, 'mode.code': 'ñ' },
      'win'
    )
    expect(clean).toEqual({ 'mode.chat': 'Mod+Alt+1', 'palette.alt': null })
    expect(sanitizeOverrides(null, 'mac')).toEqual({})
    expect(sanitizeOverrides([], 'mac')).toEqual({})
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`a${i}`, 'Mod+K']))
    expect(Object.keys(sanitizeOverrides(many, 'mac')).length).toBe(100)
  })
})

describe('conflictos y reservadas', () => {
  const eff = effectiveBindings({}, 'mac')
  it('detecta el conflicto con otra acción de la app', () => {
    const r = validateBinding('Cmd+N', 'mode.chat', eff, 'mac')
    expect(r.ok && r.conflicts.map((a) => a.id)).toEqual(['conversation.new'])
  })
  it('sin conflicto con su propio atajo actual', () => {
    const r = validateBinding('Mod+N', 'conversation.new', eff, 'mac')
    expect(r.ok && r.conflicts).toEqual([])
  })
  it('bloquea las combinaciones reservadas del sistema (macOS)', () => {
    for (const k of ['Cmd+Q', 'Cmd+H', 'Cmd+Tab', 'Cmd+Space', 'Cmd+M', 'Cmd+C']) {
      const r = validateBinding(k, 'mode.chat', eff, 'mac')
      expect(r.ok, k).toBe(false)
      expect(!r.ok && r.error).toBe('blocked')
    }
  })
  it('bloquea las reservadas de Windows y avisa de las del menú sin bloquear', () => {
    const w = effectiveBindings({}, 'win')
    for (const k of ['Alt+F4', 'Alt+Tab', 'Ctrl+Alt+Delete', 'Ctrl+Shift+Escape', 'Ctrl+V']) {
      const r = validateBinding(k, 'mode.chat', w, 'win')
      expect(!r.ok && r.error, k).toBe('blocked')
    }
    const menu = validateBinding('Ctrl+W', 'mode.chat', w, 'win')
    expect(menu.ok && menu.reserved?.level).toBe('warn')
  })
  it('exige modificador salvo en acciones que admiten atajo desnudo; las F sí valen', () => {
    expect(validateBinding('K', 'mode.chat', eff, 'mac')).toMatchObject({ ok: false, error: 'needsModifier' })
    expect(validateBinding('Shift+K', 'mode.chat', eff, 'mac')).toMatchObject({ ok: false, error: 'needsModifier' })
    expect(validateBinding('F6', 'mode.chat', eff, 'mac')).toMatchObject({ ok: true })
    expect(validateBinding('Escape', 'session.stop', eff, 'mac')).toMatchObject({ ok: true })
  })
  it('avisa si coincide con el atajo global de Quick Entry', () => {
    const r = validateBinding('Alt+Space', 'mode.chat', eff, 'mac', 'Alt+Space')
    expect(r.ok && r.sameAsQuickEntry).toBe(true)
  })
  it('ids o atajos inválidos', () => {
    expect(validateBinding('???', 'mode.chat', eff, 'mac')).toMatchObject({ ok: false, error: 'invalid' })
    expect(validateBinding('Mod+K', 'no.existe', eff, 'mac')).toMatchObject({ ok: false, error: 'invalid' })
  })
})

describe('foco', () => {
  const stop = ACTIONS_BY_ID['session.stop']
  const planBuild = ACTIONS_BY_ID['code.togglePlanBuild']
  const palette = ACTIONS_BY_ID['palette.toggle']
  it('con modificador fuerte funciona también escribiendo en un campo', () => {
    expect(hasStrongModifier('Mod+K')).toBe(true)
    expect(allowedAtFocus(palette, 'Mod+K', 'editable')).toBe(true)
  })
  it('Esc: en el compositor o fuera de campos, nunca en otros campos de texto', () => {
    expect(allowedAtFocus(stop, 'Escape', 'composer')).toBe(true)
    expect(allowedAtFocus(stop, 'Escape', 'idle')).toBe(true)
    expect(allowedAtFocus(stop, 'Escape', 'editable')).toBe(false)
  })
  it('Shift+Tab (Plan/Build) solo en el compositor: fuera es navegación del foco', () => {
    expect(allowedAtFocus(planBuild, 'Shift+Tab', 'composer')).toBe(true)
    expect(allowedAtFocus(planBuild, 'Shift+Tab', 'idle')).toBe(false)
    expect(allowedAtFocus(planBuild, 'Shift+Tab', 'editable')).toBe(false)
  })
  it('un atajo desnudo en una acción que no lo declara nunca se dispara', () => {
    expect(allowedAtFocus(ACTIONS_BY_ID['mode.chat'], 'K', 'idle')).toBe(false)
  })
})

describe('presentación', () => {
  it('símbolos en macOS y nombres en Windows', () => {
    expect(bindingDisplay('Mod+Shift+P', 'mac')).toEqual(['⌘', '⇧', 'P'])
    expect(bindingDisplay('Mod+Shift+P', 'win')).toEqual(['Ctrl', 'Shift', 'P'])
    expect(bindingDisplay('Ctrl+Tab', 'mac')).toEqual(['⌃', '⇥'])
    expect(bindingDisplay('Alt+Space', 'win', 'Espacio')).toEqual(['Alt', 'Espacio'])
    expect(bindingDisplay('Mod+Plus', 'mac')).toEqual(['⌘', '+'])
  })
})
