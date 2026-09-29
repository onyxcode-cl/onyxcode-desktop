import { describe, expect, it } from 'vitest'
import { canAdvance, decideOnboarding, hasConfiguredProvider, nextStep, prevStep, ONBOARDING_STEPS, type OnboardingInputs } from './steps'

const base: OnboardingInputs = { onboarded: false, binary: 'found', server: 'ready', connected: [{ id: 'opencode-go', source: 'api' }] }
const decide = (patch: Partial<OnboardingInputs>) => decideOnboarding({ ...base, ...patch })

describe('decideOnboarding', () => {
  it('onboarded=true nunca muestra nada, pase lo que pase', () => {
    expect(decide({ onboarded: true })).toEqual({ kind: 'hidden' })
    expect(decide({ onboarded: true, binary: 'missing' })).toEqual({ kind: 'hidden' })
    expect(decide({ onboarded: true, connected: [] })).toEqual({ kind: 'hidden' })
  })

  it('usuario existente (binario, servidor listo y proveedor): marca onboarded en silencio', () => {
    expect(decide({})).toEqual({ kind: 'complete' })
    expect(decide({ connected: [{ id: 'anthropic', source: 'env' }] })).toEqual({ kind: 'complete' })
  })

  it('falta el binario: paso 1, sin esperar al servidor ni a los proveedores', () => {
    expect(decide({ binary: 'missing', server: 'error', connected: null })).toEqual({ kind: 'show', step: 'opencode' })
    expect(decide({ binary: 'missing', server: 'starting' })).toEqual({ kind: 'show', step: 'opencode' })
  })

  it('binario presente y ningún proveedor: paso 2', () => {
    expect(decide({ connected: [] })).toEqual({ kind: 'show', step: 'auth' })
  })

  it('el proveedor gratuito preinstalado (opencode, origen custom) no cuenta como conectado', () => {
    expect(decide({ connected: [{ id: 'opencode', source: 'custom' }] })).toEqual({ kind: 'show', step: 'auth' })
    expect(hasConfiguredProvider([{ id: 'opencode', source: 'api' }])).toBe(true)
    expect(
      hasConfiguredProvider([
        { id: 'opencode', source: 'custom' },
        { id: 'opencode-go', source: 'api' }
      ])
    ).toBe(true)
  })

  it('espera mientras faltan datos: binario desconocido, servidor sin listo o proveedores sin cargar', () => {
    expect(decide({ binary: 'unknown' })).toEqual({ kind: 'wait' })
    expect(decide({ server: 'starting' })).toEqual({ kind: 'wait' })
    expect(decide({ server: 'error' })).toEqual({ kind: 'wait' })
    expect(decide({ connected: null })).toEqual({ kind: 'wait' })
  })
})

describe('navegación', () => {
  it('los cinco pasos van en orden y los extremos no tienen vecino', () => {
    expect(ONBOARDING_STEPS).toEqual(['opencode', 'auth', 'model', 'modes', 'permissions'])
    expect(prevStep('opencode')).toBeNull()
    expect(nextStep('opencode')).toBe('auth')
    expect(nextStep('modes')).toBe('permissions')
    expect(nextStep('permissions')).toBeNull()
    expect(prevStep('permissions')).toBe('modes')
  })

  it('solo el paso 1 exige binario y servidor listos para avanzar', () => {
    expect(canAdvance('opencode', { binaryFound: false, serverReady: false })).toBe(false)
    expect(canAdvance('opencode', { binaryFound: true, serverReady: false })).toBe(false)
    expect(canAdvance('opencode', { binaryFound: true, serverReady: true })).toBe(true)
    expect(canAdvance('auth', { binaryFound: false, serverReady: false })).toBe(true)
  })
})
