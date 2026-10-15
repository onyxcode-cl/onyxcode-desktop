import { describe, expect, it } from 'vitest'
import { expandStepGroups, parseReadingMode, showReasoning, showStepGroup } from './reading-mode'

describe('modos de lectura', () => {
  it('un valor desconocido cae a normal', () => {
    expect(parseReadingMode(null)).toBe('normal')
    expect(parseReadingMode('x')).toBe('normal')
    expect(parseReadingMode('summary')).toBe('summary')
    expect(parseReadingMode('detailed')).toBe('detailed')
  })
  it('normal y detallado muestran todos los grupos', () => {
    for (const mode of ['normal', 'detailed'] as const) expect(showStepGroup(mode, { hasPending: false, hasError: false })).toBe(true)
  })
  it('resumen oculta los grupos, salvo con permiso pendiente o error', () => {
    expect(showStepGroup('summary', { hasPending: false, hasError: false })).toBe(false)
    expect(showStepGroup('summary', { hasPending: true, hasError: false })).toBe(true)
    expect(showStepGroup('summary', { hasPending: false, hasError: true })).toBe(true)
  })
  it('el razonamiento solo se oculta en resumen', () => {
    expect(showReasoning('summary')).toBe(false)
    expect(showReasoning('normal')).toBe(true)
    expect(showReasoning('detailed')).toBe(true)
  })
  it('solo detallado fuerza abierto', () => {
    expect(expandStepGroups('detailed')).toBe(true)
    expect(expandStepGroups('normal')).toBe(false)
    expect(expandStepGroups('summary')).toBe(false)
  })
})
