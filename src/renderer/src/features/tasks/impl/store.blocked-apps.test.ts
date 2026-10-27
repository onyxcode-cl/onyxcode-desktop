/**
 * P4: los avisos «app bloqueada» del hilo (`blockedApps`): dedupe por app y tipo, descarte del evento sin `sessionId`,
 * limpieza al desbloquear en Ajustes (kind «user») y al terminar la tarea / revocar el plan (planState false).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ handlers: {} as Record<string, (p: never) => void> }))
vi.mock('./bridge', () => ({
  cw: vi.fn(() => Promise.resolve([])),
  onTasks: (ev: string, fn: (p: never) => void) => {
    h.handlers[ev] = fn
    return () => undefined
  },
  onTasksPush: vi.fn()
}))
vi.mock('../../../lib/notify', () => ({ sendNotification: vi.fn(), setAttentionCount: vi.fn() }))

let C: typeof import('./store')
const emit = (ev: string, p: unknown): void => h.handlers[ev]?.(p as never)
const A = { bundleId: 'com.a', name: 'A' }

beforeEach(async () => {
  vi.resetModules()
  h.handlers = {}
  localStorage.clear()
  C = await import('./store')
  C.syncAccessRequests()
  C.useTasks.setState({ blockedApps: {}, activeTaskId: 'activa', grants: { grants: [], denied: ['com.a'] } })
})
const blocked = (): Record<string, Array<{ bundleId: string; kind: string }>> => C.useTasks.getState().blockedApps

describe('avisos de apps bloqueadas', () => {
  it('descarta el evento sin sessionId (no se pinta en la tarea activa)', () => {
    emit('computer:blockedApps', { apps: [{ ...A, kind: 'user' }] })
    expect(blocked()).toEqual({})
  })

  it('dedupe: el mismo app y tipo no se repite; si cambia el tipo, reemplaza a la fila anterior', () => {
    emit('computer:blockedApps', { sessionId: 't1', apps: [{ ...A, kind: 'session' }] })
    emit('computer:blockedApps', { sessionId: 't1', apps: [{ ...A, kind: 'session' }] })
    expect(blocked().t1).toHaveLength(1)
    emit('computer:blockedApps', { sessionId: 't1', apps: [{ ...A, kind: 'user' }] })
    expect(blocked().t1.map((b) => `${b.bundleId}:${b.kind}`)).toEqual(['com.a:user'])
  })

  it('al desbloquear la app en Ajustes se quita el aviso «user» (y deja los de otro tipo)', () => {
    const B = { bundleId: 'com.b', name: 'B' }
    emit('computer:blockedApps', { sessionId: 't1', apps: [{ ...A, kind: 'user' }, { ...B, kind: 'session' }] })
    emit('computer:blockedApps', { sessionId: 't2', apps: [{ ...A, kind: 'user' }] })
    C.useTasks.setState({ grants: { grants: [], denied: [] } })
    expect(blocked().t1.map((b) => b.bundleId)).toEqual(['com.b'])
    expect(blocked().t2).toBeUndefined()
  })

  it('mientras siga en «Bloqueadas por ti», el aviso se mantiene', () => {
    emit('computer:blockedApps', { sessionId: 't1', apps: [{ ...A, kind: 'user' }] })
    C.useTasks.setState({ grants: { grants: [], denied: ['com.a', 'com.z'] } })
    expect(blocked().t1).toHaveLength(1)
  })

  it('fin de la tarea / plan revocado (planState false) limpia sus avisos y no los de otra tarea', () => {
    emit('computer:blockedApps', { sessionId: 't1', apps: [{ ...A, kind: 'session' }] })
    emit('computer:blockedApps', { sessionId: 't2', apps: [{ ...A, kind: 'session' }] })
    emit('computer:planState', { sessionId: 't1', approved: false })
    expect(blocked().t1).toBeUndefined()
    expect(blocked().t2).toHaveLength(1)
  })
})
