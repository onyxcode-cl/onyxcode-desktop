import { describe, expect, it } from 'vitest'
import { CHANNEL_ROLES, IPC_SCHEMAS } from '../ipc/schemas'
import { REMOTE_INVOKE_CHANNELS } from '@shared/ipc-remote'
import { CELULAR_POLICY } from './policy'

describe('canales de «fuera de casa»', () => {
  it('remote:setConnection solo admite lan o cloud y nada más', () => {
    const v = IPC_SCHEMAS['remote:setConnection']
    expect(v({ connection: 'lan' })).toEqual({ connection: 'lan' })
    expect(v({ connection: 'cloud' })).toEqual({ connection: 'cloud' })
    for (const bad of [{}, { connection: 'otro' }, { connection: 'LAN' }, { connection: 'cloud', extra: 1 }, { connection: 1 }, null])
      expect(() => v(bad), JSON.stringify(bad)).toThrow()
  })

  it('remote:setAway solo admite un booleano', () => {
    const v = IPC_SCHEMAS['remote:setAway']
    expect(v({ on: true })).toEqual({ on: true })
    for (const bad of [{}, { on: 'si' }, { on: 1 }, { on: true, extra: 1 }]) expect(() => v(bad)).toThrow()
  })

  it('los dos están en la lista de canales, solo los usa la ventana principal y para el celular son X (prohibidos)', () => {
    for (const ch of ['remote:setConnection', 'remote:setAway'] as const) {
      expect(REMOTE_INVOKE_CHANNELS).toContain(ch)
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(ch), `${role} ${ch}`).toBe(false)
      expect(CELULAR_POLICY[ch]).toBe('X')
    }
  })
})
