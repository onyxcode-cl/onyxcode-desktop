import { describe, expect, it } from 'vitest'
import { formatStepDuration, stepDurationMs, stepKind, stepStartedAt } from './tool-look'

describe('stepKind', () => {
  it.each([
    ['computer_click', 'mac'],
    ['webfetch', 'web'],
    ['browser_navigate_page', 'web'],
    ['write', 'create'],
    ['edit', 'create'],
    ['read', 'read'],
    ['glob', 'read'],
    ['bash', 'terminal'],
    ['skill', 'other']
  ] as const)('%s → %s', (tool, kind) => {
    expect(stepKind(tool)).toBe(kind)
  })
})

describe('stepStartedAt', () => {
  it('lee time.start y descarta valores raros', () => {
    expect(stepStartedAt({ time: { start: 1700000000000 } })).toBe(1700000000000)
    expect(stepStartedAt({ time: {} })).toBeNull()
    expect(stepStartedAt(null)).toBeNull()
    expect(stepStartedAt({ time: { start: 0 } })).toBeNull()
  })
})

describe('stepDurationMs / formatStepDuration (U4)', () => {
  it('calcula lo que tardó el paso y es null si no terminó o los tiempos no sirven', () => {
    expect(stepDurationMs({ time: { start: 1000, end: 3000 } })).toBe(2000)
    expect(stepDurationMs({ time: { start: 1000 } })).toBeNull()
    expect(stepDurationMs({ time: { start: 5000, end: 1000 } })).toBeNull()
    expect(stepDurationMs(null)).toBeNull()
  })
  it('lo escribe corto', () => {
    expect(formatStepDuration(300)).toBe('<1 s')
    expect(formatStepDuration(2000)).toBe('2 s')
    expect(formatStepDuration(65_000)).toBe('1 min 5 s')
    expect(formatStepDuration(120_000)).toBe('2 min')
    expect(formatStepDuration(3_720_000)).toBe('1 h 2 min')
  })
})
