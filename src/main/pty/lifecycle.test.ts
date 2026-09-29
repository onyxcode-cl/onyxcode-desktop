import { describe, expect, it } from 'vitest'
import { shouldKillOnNavigation } from './lifecycle'

describe('shouldKillOnNavigation (F7-B26)', () => {
  it('frame principal con navegación real: mata', () => {
    expect(shouldKillOnNavigation({ isMainFrame: true, isSameDocument: false })).toBe(true)
    expect(shouldKillOnNavigation({ isMainFrame: true })).toBe(true)
  })
  it('subframe: no mata', () => {
    expect(shouldKillOnNavigation({ isMainFrame: false, isSameDocument: false })).toBe(false)
  })
  it('mismo documento (hash/pushState): no mata', () => {
    expect(shouldKillOnNavigation({ isMainFrame: true, isSameDocument: true })).toBe(false)
  })
})
