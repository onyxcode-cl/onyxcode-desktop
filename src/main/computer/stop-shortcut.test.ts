import { describe, expect, it } from 'vitest'
import { STOP_SHORTCUT_MAC, STOP_SHORTCUT_WIN, stopShortcutFor } from './stop-shortcut'
import { parseCombo, WIN_STOP_SHORTCUT } from './policy/win-keys'

describe('atajo global de parada por plataforma', () => {
  it('macOS conserva el de siempre', () => {
    expect(stopShortcutFor('darwin')).toBe('CommandOrControl+Shift+Escape')
    expect(STOP_SHORTCUT_MAC).toBe('CommandOrControl+Shift+Escape')
  })
  it('Windows NO usa Ctrl+Shift+Esc (Administrador de tareas): usa Ctrl+Alt+Shift+Esc', () => {
    const p = parseCombo(stopShortcutFor('win32'))!
    expect(p.mods).toEqual(['ctrl', 'alt', 'shift'])
    expect(p.key).toBe('escape')
    expect(stopShortcutFor('win32')).toBe(STOP_SHORTCUT_WIN)
    expect(STOP_SHORTCUT_WIN).not.toMatch(/^CommandOrControl\+Shift\+Escape$/)
  })
  it('es el mismo atajo que la política de teclas rechaza al agente', () => {
    const p = parseCombo(STOP_SHORTCUT_WIN)!
    expect([...p.mods, p.key].join('+')).toBe(WIN_STOP_SHORTCUT)
  })
  it('cualquier otra plataforma cae en la de macOS (como siempre)', () => {
    expect(stopShortcutFor('linux')).toBe(STOP_SHORTCUT_MAC)
  })
})
