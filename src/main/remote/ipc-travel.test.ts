import { describe, expect, it } from 'vitest'
import { CHANNEL_ROLES, IPC_SCHEMAS } from '../ipc/schemas'
import { REMOTE_INVOKE_CHANNELS } from '@shared/ipc-remote'
import { TRAVEL_INVOKE_CHANNELS } from '@shared/remote/travel'
import { CELULAR_POLICY } from './policy'

describe('canales del Modo viaje', () => {
  it('remote:travelInstall exige exactamente { consent: true }', () => {
    const v = IPC_SCHEMAS['remote:travelInstall']
    expect(v({ consent: true })).toEqual({ consent: true })
    for (const bad of [undefined, null, {}, { consent: false }, { consent: 'true' }, { consent: 1 }, { consent: true, extra: 1 }, [], 'x'])
      expect(() => v(bad), JSON.stringify(bad)).toThrow()
  })

  it('remote:setTravelKeep solo admite las cuatro duraciones y nada más', () => {
    const v = IPC_SCHEMAS['remote:setTravelKeep']
    for (const keep of ['idle30', 'h4', 'h12', 'h24']) expect(v({ keep })).toEqual({ keep })
    for (const bad of [{}, { keep: 'h48' }, { keep: 'H4' }, { keep: 4 }, { keep: 'h4', extra: 1 }, null, 'h4'])
      expect(() => v(bad), JSON.stringify(bad)).toThrow()
  })

  it('están en la lista de canales, solo los usa la ventana principal y para el celular son X', () => {
    for (const ch of TRAVEL_INVOKE_CHANNELS) {
      expect(REMOTE_INVOKE_CHANNELS).toContain(ch)
      expect(IPC_SCHEMAS[ch]).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(ch), `${role} ${ch}`).toBe(false)
      expect(CELULAR_POLICY[ch]).toBe('X')
    }
  })
})
