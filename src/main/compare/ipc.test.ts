import { describe, expect, it } from 'vitest'
import { CODE_EVENTS, CODE_INVOKE_CHANNELS } from '@shared/ipc-code'
import { CHANNEL_ROLES, IPC_SCHEMAS } from '../ipc/schemas'
import { CELULAR_EVENTS, CELULAR_POLICY, decide, type PolicyContext } from '../remote/policy'

const COMPARE = CODE_INVOKE_CHANNELS.filter((c) => c.startsWith('compare:'))
const ID = '0a1b2c3d-1111-4222-8333-444455556666'
const models = [
  { providerID: 'opencode-go', modelID: 'a' },
  { providerID: 'anthropic', modelID: 'b', variant: 'high' }
]
const v = (ch: string, payload: unknown): unknown => IPC_SCHEMAS[ch](payload, '')

describe('canales compare:*', () => {
  it('son los diez esperados y todos tienen esquema', () => {
    expect([...COMPARE].sort()).toEqual(
      [
        'compare:list',
        'compare:preflight',
        'compare:start',
        'compare:cancel',
        'compare:retry',
        'compare:diff',
        'compare:adopt',
        'compare:discard',
        'compare:close',
        'compare:exportBench'
      ].sort()
    )
    for (const c of COMPARE) expect(IPC_SCHEMAS[c], c).toBeTypeOf('function')
  })

  it('solo la ventana principal los invoca (ningún rol secundario los tiene)', () => {
    for (const set of Object.values(CHANNEL_ROLES)) for (const c of COMPARE) expect(set.has(c), c).toBe(false)
  })

  it('rechazan claves extra (rutas, ramas, estado…)', () => {
    expect(() => v('compare:diff', { id: ID, index: 0, path: '/etc' })).toThrow()
    expect(() => v('compare:discard', { id: ID, index: 0, branch: 'main' })).toThrow()
    expect(() => v('compare:adopt', { id: ID, index: 0, patch: 'x' })).toThrow()
    expect(() => v('compare:close', { id: ID, worktree: '/x' })).toThrow()
    expect(() => v('compare:exportBench', { id: ID, path: '/tmp/x.json' })).toThrow()
    expect(() => v('compare:start', { id: ID, mode: 'code', cwd: '/p', models, prompt: 'x', worktrees: ['/x'] })).toThrow()
  })

  it('índice de 0 a 3 entero; id uuid', () => {
    expect(v('compare:diff', { id: ID, index: 3 })).toEqual({ id: ID, index: 3 })
    for (const index of [4, -1, 1.5, '0']) expect(() => v('compare:diff', { id: ID, index })).toThrow()
    expect(() => v('compare:diff', { id: '../../x', index: 0 })).toThrow()
    expect(() => v('compare:diff', { id: ID })).toThrow()
    expect(v('compare:cancel', { id: ID })).toEqual({ id: ID })
  })

  it('models: de 2 a 4 (1 y 5 se rechazan)', () => {
    const base = { id: ID, mode: 'code', cwd: '/p', prompt: 'hola' }
    expect(v('compare:start', { ...base, models })).toMatchObject({ id: ID })
    expect(() => v('compare:start', { ...base, models: models.slice(0, 1) })).toThrow()
    expect(() => v('compare:start', { ...base, models: [] })).toThrow()
    expect(() =>
      v('compare:start', { ...base, models: Array.from({ length: 5 }, (_, i) => ({ providerID: 'p', modelID: 'm' + i })) })
    ).toThrow()
    expect(() => v('compare:start', { ...base, models: [{ ...models[0], extra: 1 }, models[1]] })).toThrow()
    expect(() => v('compare:start', { ...base, cwd: 'relativa', models })).toThrow()
    expect(() => v('compare:start', { ...base, models, prompt: '' })).toThrow()
    expect(() => v('compare:start', { ...base, models, permissionMode: 'root' })).toThrow()
  })
})

describe('compare:* en el celular', () => {
  const ctx: PolicyContext = {
    allowedDirs: ['/work/proj'],
    chatDirs: [],
    fullAccessDirs: [],
    knownModels: new Set(),
    permissionKind: () => undefined,
    isDirectory: () => true,
    home: '/Users/me'
  }

  it('todos son clase X (prohibidos) y sus eventos no se reenvían', () => {
    for (const c of COMPARE) {
      expect(CELULAR_POLICY[c], c).toBe('X')
      const d = decide({ kind: 'ipc', channel: c, payload: { id: ID, index: 0, cwd: '/work/proj' } }, ctx)
      expect('allow' in d && d.allow, c).toBe(false)
    }
    expect(CELULAR_EVENTS[CODE_EVENTS.compareChanged]).toBe('deny')
  })
})
