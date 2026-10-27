import { describe, expect, it } from 'vitest'
import { defaultAccessDecision } from './ipc-tasks'

describe('defaultAccessDecision', () => {
  it('lo que declara el agente, por defecto «Ver y clic»', () => {
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A' })).toBe('click')
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'view' })).toBe('view')
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'click' })).toBe('click')
  })
  it('«Control total» pedido por el agente NO se preselecciona si no estaba concedido (ni siquiera denegada antes)', () => {
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'full' })).toBe('click')
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'full', current: null })).toBe('click')
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'full', current: 'view' })).toBe('click')
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'full', denied: true })).toBe('click')
  })
  it('lo ya concedido nunca baja', () => {
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'full', current: 'full' })).toBe('full')
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'view', current: 'full' })).toBe('full')
    expect(defaultAccessDecision({ bundleId: 'a', name: 'A', requested: 'view', current: 'click' })).toBe('click')
  })
})
