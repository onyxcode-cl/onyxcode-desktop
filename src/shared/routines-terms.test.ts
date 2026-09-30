import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from './types'
import { needsRoutinesConsent, needsRoutinesNotice, shouldRunUnattended } from './routines-terms'

describe('shouldRunUnattended', () => {
  it('por defecto no ejecuta solas', () => {
    expect(DEFAULT_SETTINGS.routinesTermsAcknowledged).toBe(false)
    expect(shouldRunUnattended(DEFAULT_SETTINGS)).toBe(false)
  })
  it('solo con true estricto', () => {
    expect(shouldRunUnattended({ routinesTermsAcknowledged: true })).toBe(true)
    expect(shouldRunUnattended({ routinesTermsAcknowledged: false })).toBe(false)
    expect(shouldRunUnattended(undefined)).toBe(false)
    expect(shouldRunUnattended(null)).toBe(false)
    expect(shouldRunUnattended({ routinesTermsAcknowledged: 'true' as unknown as boolean })).toBe(false)
  })
})

describe('needsRoutinesNotice', () => {
  it('solo con rutinas activas y sin reconocimiento', () => {
    expect(needsRoutinesNotice(false, [{ enabled: true }])).toBe(true)
    expect(needsRoutinesNotice(false, [{ enabled: false }, { enabled: true }])).toBe(true)
    expect(needsRoutinesNotice(false, [{ enabled: false }])).toBe(false)
    expect(needsRoutinesNotice(false, [])).toBe(false)
    expect(needsRoutinesNotice(true, [{ enabled: true }])).toBe(false)
  })
})

describe('needsRoutinesConsent', () => {
  it('pide el reconocimiento solo al activar sin haberlo dado', () => {
    expect(needsRoutinesConsent(false, true)).toBe(true)
    expect(needsRoutinesConsent(false, false)).toBe(false)
    expect(needsRoutinesConsent(true, true)).toBe(false)
  })
})
