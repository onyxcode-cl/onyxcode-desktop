import { describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: {}, net: {} }))
const video = vi.hoisted(() => ({ estado: vi.fn(() => ({ ready: false })), instalar: vi.fn(), cancelar: vi.fn(), quitar: vi.fn() }))
vi.mock('../video/service', () => ({ videoService: () => video }))
vi.mock('../doctor/service', () => ({ runRealDoctor: vi.fn() }))
vi.mock('../office/craft/service', () => ({ craftService: () => ({}) }))
vi.mock('../runtimes/service', () => ({ runtimesService: () => ({}) }))
import { registerTasksCraftHandlers } from './tasks-craft-handlers'
import { IPC_SCHEMAS } from './schemas'
import { CELULAR_POLICY } from '../remote/policy'

describe('IPC video solo desde la ventana principal', () => {
  it('cablea las cuatro acciones, sin rutas o payloads elegidos por renderer/celular', () => {
    const handlers = new Map<string, () => unknown>()
    registerTasksCraftHandlers({ handle: (c: string, fn: unknown) => handlers.set(c, fn as () => unknown) } as never)
    for (const [channel, method] of [
      ['status', 'estado'],
      ['install', 'instalar'],
      ['cancel', 'cancelar'],
      ['remove', 'quitar']
    ] as const) {
      handlers.get(`video:${channel}`)!()
      expect(video[method]).toHaveBeenCalledOnce()
      expect(() => IPC_SCHEMAS[`video:${channel}`]({ url: 'https://evil.test' })).toThrow()
      expect(CELULAR_POLICY[`video:${channel}`]).toBe('X')
    }
  })
})

it('clave solo por ventana principal, esquema cerrado y estado sin payload', () => {
  expect(CELULAR_POLICY['video:imageSearchSave']).toBe('X')
  expect(CELULAR_POLICY['video:imageSearchStatus']).toBe('X')
  expect(IPC_SCHEMAS['video:imageSearchSave']({ provider: 'serper', key: 'placeholder' })).toEqual({
    provider: 'serper',
    key: 'placeholder'
  })
  for (const value of [{ provider: 'other' }, { provider: 'brave', key: 'bad\nkey' }, { provider: 'serper', path: '/tmp/key' }])
    expect(() => IPC_SCHEMAS['video:imageSearchSave'](value)).toThrow()
  expect(() => IPC_SCHEMAS['video:imageSearchStatus']({})).toThrow()
})
