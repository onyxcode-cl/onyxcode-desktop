import { describe, expect, it } from 'vitest'
import { shouldQuitOnMainWindowClosed, shouldQuitWhenAllWindowsClosed as quit } from './lifecycle'

const base = { remoteWinOn: true, remoteActive: true, hasTray: true }

describe('shouldQuitWhenAllWindowsClosed', () => {
  it('macOS no cierra nunca (como hoy)', () => {
    expect(quit({ platform: 'darwin', ...base })).toBe(false)
    expect(quit({ platform: 'darwin', remoteWinOn: false, remoteActive: false, hasTray: false })).toBe(false)
  })
  it('Windows con remoto activo, bandera y bandeja se queda en la bandeja', () => {
    expect(quit({ platform: 'win32', ...base })).toBe(false)
  })
  it.each([
    ['sin la bandera', { ...base, remoteWinOn: false }],
    ['remoto apagado', { ...base, remoteActive: false }],
    ['sin bandeja', { ...base, hasTray: false }]
  ])('Windows %s cierra como siempre', (_n, over) => {
    expect(quit({ platform: 'win32', ...over })).toBe(true)
  })
  it('Linux cierra siempre', () => {
    expect(quit({ platform: 'linux', ...base })).toBe(true)
  })
})

describe('shouldQuitOnMainWindowClosed', () => {
  it('Windows con remoto activo y bandeja no se cierra', () => {
    expect(shouldQuitOnMainWindowClosed({ platform: 'win32', ...base })).toBe(false)
  })
  it('Windows sin bandeja se cierra', () => {
    expect(shouldQuitOnMainWindowClosed({ platform: 'win32', ...base, hasTray: false })).toBe(true)
  })
  it('Windows sin remoto o sin bandera se cierra', () => {
    expect(shouldQuitOnMainWindowClosed({ platform: 'win32', ...base, remoteActive: false })).toBe(true)
    expect(shouldQuitOnMainWindowClosed({ platform: 'win32', ...base, remoteWinOn: false })).toBe(true)
  })
  it('macOS no se cierra y Linux sí', () => {
    expect(shouldQuitOnMainWindowClosed({ platform: 'darwin', ...base })).toBe(false)
    expect(shouldQuitOnMainWindowClosed({ platform: 'linux', ...base })).toBe(true)
  })
})
