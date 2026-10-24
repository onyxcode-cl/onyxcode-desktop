import { describe, expect, it } from 'vitest'
import { IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'

describe('canales jobs:* (trabajos del motor)', () => {
  it('existen en el contrato, tienen esquema y son solo de la ventana principal', () => {
    for (const c of ['jobs:list', 'jobs:stop']) {
      expect(IPC_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
    }
  })

  it('jobs:list: id de sesión y carpeta opcional; rechaza claves extra e ids con rutas', () => {
    const v = IPC_SCHEMAS['jobs:list']!
    expect(v({ sessionID: 'ses_abc123' })).toEqual({ sessionID: 'ses_abc123' })
    expect(v({ sessionID: 'ses_abc', directory: '/proj' })).toEqual({ sessionID: 'ses_abc', directory: '/proj' })
    expect(() => v({})).toThrow()
    expect(() => v({ sessionID: '' })).toThrow()
    expect(() => v({ sessionID: '../x' })).toThrow()
    expect(() => v({ sessionID: 'a/b' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', extra: 1 })).toThrow()
    expect(() => v({ sessionID: 'ses_a', directory: 3 })).toThrow()
  })

  it('jobs:stop: exige sesión y trabajo, ambos solo con caracteres de id', () => {
    const v = IPC_SCHEMAS['jobs:stop']!
    expect(v({ sessionID: 'ses_a', jobId: 'sh_1' })).toEqual({ sessionID: 'ses_a', jobId: 'sh_1' })
    expect(() => v({ sessionID: 'ses_a' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', jobId: 'sh_1/../x' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', jobId: 'sh 1' })).toThrow()
    expect(() => v({ sessionID: 'ses_a', jobId: 'sh_1', command: 'rm' })).toThrow()
  })
})
