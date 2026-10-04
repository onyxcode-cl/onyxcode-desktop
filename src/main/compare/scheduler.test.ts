import { describe, expect, it } from 'vitest'
import { COMPARE_LIMITS } from './limits'
import { pickNextStart, providerLimit, type SchedColumn } from './scheduler'

const col = (index: number, providerID: string, state: SchedColumn['state'] = 'queued', holdsSlot = false): SchedColumn => ({ index, providerID, state, holdsSlot })
const none = new Set<string>()

describe('planificador de comparaciones', () => {
  it('límites por proveedor: 2 en OpenCode Go y en Zen, 4 en el resto', () => {
    expect(providerLimit('opencode-go')).toBe(2)
    expect(providerLimit('opencode')).toBe(2)
    expect(providerLimit('anthropic')).toBe(4)
    expect(COMPARE_LIMITS.staggerMs).toBe(1500)
    expect(COMPARE_LIMITS.maxColumns).toBe(4)
  })

  it('arranca la primera columna en cola de inmediato', () => {
    expect(pickNextStart({ columns: [col(0, 'a'), col(1, 'a')], now: 1000, lastStartAt: 0, paused: none })).toEqual({ start: 0, wakeAt: null })
  })

  it('escalona 1500 ms entre arranques', () => {
    const columns = [col(0, 'a', 'running', true), col(1, 'a')]
    expect(pickNextStart({ columns, now: 10_000, lastStartAt: 10_000, paused: none })).toEqual({ start: null, wakeAt: 11_500 })
    expect(pickNextStart({ columns, now: 11_499, lastStartAt: 10_000, paused: none }).start).toBeNull()
    expect(pickNextStart({ columns, now: 11_500, lastStartAt: 10_000, paused: none })).toEqual({ start: 1, wakeAt: null })
  })

  it('OpenCode Go: nunca más de 2 a la vez; al liberarse una plaza arranca la siguiente', () => {
    const busy = [col(0, 'opencode-go', 'running', true), col(1, 'opencode-go', 'starting', true), col(2, 'opencode-go'), col(3, 'opencode-go')]
    expect(pickNextStart({ columns: busy, now: 99_999, lastStartAt: 0, paused: none })).toEqual({ start: null, wakeAt: null })
    busy[0] = col(0, 'opencode-go', 'done', false)
    expect(pickNextStart({ columns: busy, now: 99_999, lastStartAt: 1, paused: none }).start).toBe(2)
  })

  it('una columna esperando su reintento por cuota sigue ocupando su plaza', () => {
    const cols = [col(0, 'opencode', 'rateLimited', true), col(1, 'opencode', 'running', true), col(2, 'opencode')]
    expect(pickNextStart({ columns: cols, now: 99_999, lastStartAt: 1, paused: none }).start).toBeNull()
  })

  it('la pausa de un proveedor no bloquea a los demás', () => {
    const cols = [col(0, 'opencode-go'), col(1, 'anthropic')]
    expect(pickNextStart({ columns: cols, now: 5000, lastStartAt: 0, paused: new Set(['opencode-go']) }).start).toBe(1)
    expect(pickNextStart({ columns: [col(0, 'opencode-go')], now: 5000, lastStartAt: 0, paused: new Set(['opencode-go']) })).toEqual({ start: null, wakeAt: null })
  })

  it('una columna cancelada en cola nunca arranca', () => {
    expect(pickNextStart({ columns: [col(0, 'a', 'cancelled'), col(1, 'a', 'done')], now: 5000, lastStartAt: 0, paused: none }).start).toBeNull()
  })

  it('tope de 4 columnas', () => {
    const cols = [0, 1, 2, 3, 4].map((i) => col(i, 'p' + i, i === 4 ? 'queued' : 'done'))
    expect(pickNextStart({ columns: cols, now: 5000, lastStartAt: 0, paused: none }).start).toBeNull()
  })
})
