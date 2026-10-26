import { describe, expect, it } from 'vitest'
import { IPC_INVOKE_CHANNELS } from '@shared/ipc'
import { CELULAR_POLICY } from '../remote/policy'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'

const CHANNELS = ['helpers:pickFolder', 'helpers:list', 'helpers:read', 'helpers:save', 'helpers:inspectForeign'] as const
const DIR = '/Users/x/proyecto'
const DEF = {
  name: 'lector',
  description: 'Lee',
  prompt: 'Lee.',
  model: 'small',
  allowedTools: [],
  disallowedTools: ['edit'],
  maxTurns: 3,
  background: false,
  skills: null
}

describe('canales helpers:* (Ajustes › Ayudantes)', () => {
  it('existen, tienen esquema, son solo de la ventana principal y clase X para el celular', () => {
    for (const c of CHANNELS) {
      expect(IPC_INVOKE_CHANNELS as readonly string[], c).toContain(c)
      expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
      for (const [role, set] of Object.entries(CHANNEL_ROLES)) expect(set.has(c), `${c} en ${role}`).toBe(false)
      expect((CELULAR_POLICY as Record<string, string>)[c], c).toBe('X')
    }
  })

  it('list/read/inspect: carpeta absoluta y nada más', () => {
    expect(IPC_SCHEMAS['helpers:list']!({ directory: DIR })).toEqual({ directory: DIR })
    expect(() => IPC_SCHEMAS['helpers:list']!({ directory: 'relativa' })).toThrow()
    expect(() => IPC_SCHEMAS['helpers:list']!({ directory: DIR, extra: 1 })).toThrow()
    expect(() => IPC_SCHEMAS['helpers:inspectForeign']!({})).toThrow()
    expect(IPC_SCHEMAS['helpers:read']!({ directory: DIR, name: 'a.b-c_1' })).toBeTruthy()
    for (const name of ['../x', 'a/b', '.x', '', 'a b', 'a'.repeat(65)])
      expect(() => IPC_SCHEMAS['helpers:read']!({ directory: DIR, name }), name).toThrow()
  })

  it('save: modo, definición completa con topes; sin claves extra ni rutas', () => {
    const v = IPC_SCHEMAS['helpers:save']!
    expect(v({ directory: DIR, mode: 'create', def: DEF })).toBeTruthy()
    expect(() => v({ directory: DIR, mode: 'borrar', def: DEF })).toThrow()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, path: '/etc' } })).toThrow()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, name: '../x' } })).toThrow()
    for (const bad of [['a b'], ['x\ny'], ['a:b'], ['a'.repeat(65)], Array.from({ length: 31 }, (_, i) => `t${i}`), 'Read'])
      expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, allowedTools: bad } }), JSON.stringify(bad).slice(0, 30)).toThrow()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, allowedTools: undefined } })).toThrow()
    expect(v({ directory: DIR, mode: 'edit', def: { ...DEF, allowedTools: ['Read', 'mcp__s__t', '*'] } })).toBeTruthy()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, maxTurns: 0 } })).toThrow()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, maxTurns: 2.5 } })).toThrow()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, disallowedTools: ['a b'] } })).toThrow()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, prompt: 'x'.repeat(32_001) } })).toThrow()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, skills: 'todas' } })).toThrow()
    expect(() => v({ directory: DIR, mode: 'edit', def: { ...DEF, directory: '/x' } })).toThrow()
  })

  it('settings:set acepta modoPlan booleano y la política lo trata como X', () => {
    expect(IPC_SCHEMAS['settings:set']!({ modoPlan: true })).toEqual({ modoPlan: true })
    expect(() => IPC_SCHEMAS['settings:set']!({ modoPlan: 'si' })).toThrow()
    expect((CELULAR_POLICY as unknown as Record<string, unknown>)['modoPlan']).toBeUndefined() // es un ajuste, no un canal
  })
})
