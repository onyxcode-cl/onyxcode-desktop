import { describe, expect, it, vi } from 'vitest'
import { getFault, setFault, shouldThrow, subscribeFault } from './e2e-fault'

describe('e2e-fault', () => {
  it('shouldThrow coincide por modo o comodín', () => {
    expect(shouldThrow(null, 'chat')).toBe(false)
    expect(shouldThrow('code', 'chat')).toBe(false)
    expect(shouldThrow('chat', 'chat')).toBe(true)
    expect(shouldThrow('*', 'tasks')).toBe(true)
  })
  it('setFault notifica solo ante cambios y se puede desuscribir', () => {
    const fn = vi.fn()
    const off = subscribeFault(fn)
    setFault('chat')
    setFault('chat')
    expect(getFault()).toBe('chat')
    expect(fn).toHaveBeenCalledTimes(1)
    setFault(null)
    expect(fn).toHaveBeenCalledTimes(2)
    off()
    setFault('code')
    expect(fn).toHaveBeenCalledTimes(2)
    setFault(null)
  })
})
