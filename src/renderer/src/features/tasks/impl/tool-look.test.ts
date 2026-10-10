import { describe, expect, it } from 'vitest'
import { stepKind, stepStartedAt } from './tool-look'

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
