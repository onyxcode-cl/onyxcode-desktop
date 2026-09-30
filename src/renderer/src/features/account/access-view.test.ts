import { describe, expect, it } from 'vitest'
import { accessBanner, accessView, markNoteSeen, noteSeen, shouldShowExistingUserNote } from './access-view'

describe('accessView', () => {
  it('validando la sesión guardada → checking (prevalece)', () => {
    expect(accessView({ checking: true, status: 'signed-out' })).toBe('checking')
  })
  it('esperando al navegador → waiting', () => {
    expect(accessView({ checking: false, status: 'signing-in' })).toBe('waiting')
  })
  it('sin red pasados 30 días → offline', () => {
    expect(accessView({ checking: false, status: 'offline-blocked' })).toBe('offline')
  })
  it.each(['signed-out', 'expired', 'deleted'] as const)('%s → choose', (status) => {
    expect(accessView({ checking: false, status })).toBe('choose')
  })
})

describe('accessBanner', () => {
  it('sesión caducada/revocada y cuenta borrada tienen aviso; el resto no', () => {
    expect(accessBanner({ status: 'expired' })?.title).toBe('Tu sesión terminó')
    expect(accessBanner({ status: 'deleted' })?.title).toBe('Esta cuenta ya no existe')
    expect(accessBanner({ status: 'signed-out' })).toBeNull()
    expect(accessBanner({ status: 'offline-blocked' })).toBeNull()
  })
})

describe('nota de quien ya tenía la app', () => {
  it('solo si ya había terminado el asistente y no la vio', () => {
    expect(shouldShowExistingUserNote({ onboarded: true, seen: false })).toBe(true)
    expect(shouldShowExistingUserNote({ onboarded: true, seen: true })).toBe(false)
    expect(shouldShowExistingUserNote({ onboarded: false, seen: false })).toBe(false)
  })
  it('se recuerda en localStorage', () => {
    expect(noteSeen()).toBe(false)
    markNoteSeen()
    expect(noteSeen()).toBe(true)
  })
})
