import { MODE_LABELS } from '@shared/labels'
import { describe, expect, it } from 'vitest'
import {
  canAdvance,
  decideOnboarding,
  connectedNames,
  CONNECT_TASKS_NOTICE,
  CONNECT_TERMS_NOTICE,
  hasConfiguredProvider,
  isConfiguredProvider,
  nextStep,
  opencodeStepMode,
  prevStep,
  stepTitle,
  ONBOARDING_STEPS,
  type OnboardingInputs
} from './steps'

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
    expect(decide({ connected: [{ id: 'openai', source: 'env' }] })).toEqual({ kind: 'complete' })
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

describe('decideOnboarding según el origen del binario', () => {
  it('con el motor incluido y sin proveedor: paso 2 (el paso 1 no aparece)', () => {
    expect(decide({ source: 'bundled', connected: [] })).toEqual({ kind: 'show', step: 'auth' })
    expect(decide({ source: 'bundled', connected: [{ id: 'opencode', source: 'custom' }] })).toEqual({ kind: 'show', step: 'auth' })
  })

  it('con el motor incluido y proveedor conectado (usuario existente): no muestra nada', () => {
    expect(decide({ source: 'bundled' })).toEqual({ kind: 'complete' })
    expect(decide({ source: 'bundled', onboarded: true, connected: [] })).toEqual({ kind: 'hidden' })
  })

  it('con el motor incluido espera al servidor antes de decidir', () => {
    expect(decide({ source: 'bundled', server: 'starting', connected: null })).toEqual({ kind: 'wait' })
  })

  it('CLI propio (cli/env/settings): mismo comportamiento que siempre', () => {
    for (const source of ['cli', 'env', 'settings'] as const) {
      expect(decide({ source, connected: [] })).toEqual({ kind: 'show', step: 'auth' })
      expect(decide({ source })).toEqual({ kind: 'complete' })
    }
  })

  it('desarrollo sin binario (source null): paso 1 como hoy', () => {
    expect(decide({ binary: 'missing', source: null, server: 'error', connected: null })).toEqual({ kind: 'show', step: 'opencode' })
  })
})

describe('paso 1 informativo', () => {
  it('opencodeStepMode distingue cargando, incluido, CLI propio y ausente', () => {
    expect(opencodeStepMode(null)).toBe('loading')
    expect(opencodeStepMode({ found: false, source: null })).toBe('missing')
    expect(opencodeStepMode({ found: true, source: 'bundled' })).toBe('bundled')
    for (const source of ['cli', 'env', 'settings'] as const) expect(opencodeStepMode({ found: true, source })).toBe('found')
  })

  it('el título del paso 1 cambia solo con el motor incluido', () => {
    expect(stepTitle('opencode', 'bundled')).toBe('Motor incluido')
    expect(stepTitle('opencode', 'missing')).toBe('Instala o localiza OpenCode')
    expect(stepTitle('opencode', 'found')).toBe('Instala o localiza OpenCode')
    expect(stepTitle('auth', 'bundled')).toBe('Conecta tu IA')
  })

  it('con el motor incluido se puede continuar aunque el servidor aún no esté listo', () => {
    expect(canAdvance('opencode', { binaryFound: true, serverReady: false, source: 'bundled' })).toBe(true)
    expect(canAdvance('opencode', { binaryFound: true, serverReady: false, source: 'cli' })).toBe(false)
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

describe('paso «Conecta tu IA»', () => {
  it('cualquier proveedor con credencial cuenta como configurado, también por OAuth', () => {
    expect(isConfiguredProvider({ id: 'openai', source: 'api' })).toBe(true)
    expect(decide({ connected: [{ id: 'openai', source: 'oauth' }] })).toEqual({ kind: 'complete' })
  })

  it('connectedNames excluye el gratuito preinstalado y usa el nombre del catálogo', () => {
    const connected = [
      { id: 'opencode', source: 'custom' },
      { id: 'openai', source: 'api' },
      { id: 'otro', source: 'env' }
    ]
    expect(connectedNames(connected, { openai: 'Nombre visible' })).toEqual(['Nombre visible', 'otro'])
    expect(connectedNames(null, {})).toEqual([])
  })

  it('los avisos nombran OpenCode Go y el modo Tareas con su nombre visible', () => {
    expect(CONNECT_TASKS_NOTICE).toContain('OpenCode Go')
    expect(CONNECT_TASKS_NOTICE).toContain(MODE_LABELS.tasks)
    expect(CONNECT_TERMS_NOTICE).toContain('términos')
  })
})
