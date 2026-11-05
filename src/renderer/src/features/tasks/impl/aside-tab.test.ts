import { describe, expect, it } from 'vitest'
import { effectiveAsideTab } from './aside-tab'

describe('effectiveAsideTab (el panel derecho nunca queda en blanco)', () => {
  it('«visor» sin documento abierto vuelve a Progreso', () => {
    expect(effectiveAsideTab('viewer', { viewer: false, browser: true })).toBe('progress')
  })
  it('«navegador» sin carpeta vuelve a Progreso', () => {
    expect(effectiveAsideTab('browser', { viewer: false, browser: false })).toBe('progress')
  })
  it('respeta la pestaña elegida cuando tiene contenido', () => {
    expect(effectiveAsideTab('viewer', { viewer: true, browser: false })).toBe('viewer')
    expect(effectiveAsideTab('browser', { viewer: false, browser: true })).toBe('browser')
    expect(effectiveAsideTab('progress', { viewer: false, browser: false })).toBe('progress')
  })
})
