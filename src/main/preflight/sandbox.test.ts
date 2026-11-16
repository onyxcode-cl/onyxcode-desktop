import { describe, expect, it, vi } from 'vitest'
import { autoInstallPlan } from '@shared/preflight'
import { readStartupSandbox } from './sandbox'
import { runPreflightChecks } from './service'

const output = (stdout = '', code: number | null = 0, error?: string) => ({
  stdout: Buffer.from(stdout, 'utf16le'),
  stderr: Buffer.alloc(0),
  code,
  error
})

describe('Windows: inventario sin encender ni cargar la distro', () => {
  it.each([
    ['sin WSL', output('', null, 'ENOENT'), output('', null, 'ENOENT'), 'needsWsl', false],
    ['sin distro', output('WSL: 2.6.0.0\nKernel: 6.6.0.0'), output(''), 'needsSetup', true],
    ['lista vacía con error', output('WSL: 2.6.0.0\nKernel: 6.6.0.0'), output('', 1), 'needsSetup', true],
    ['lista con distro', output('WSL: 2.6.0.0\nKernel: 6.6.0.0'), output('* Lazunox-Tareas  Stopped  2'), 'ready', false]
  ] as const)('%s: componente y plan correctos', async (_label, version, list, state, installable) => {
    const run = vi.fn(async (kind: 'version' | 'list') => (kind === 'version' ? version : list))
    const sandbox = await readStartupSandbox({ platform: 'win32', available: true, policyDisabled: () => false, run })
    expect(sandbox.state).toBe(state)
    expect(run.mock.calls.map(([kind]) => kind)).toEqual(['version', 'list'])
    const report = await runPreflightChecks({
      platform: 'win32',
      appVersion: '1',
      now: () => 0,
      engine: async () => ({ found: true, version: '1' }),
      craft: () => ({ state: 'unsupported', parts: [] }),
      sandbox: async () => sandbox,
      freeBytes: () => 50e9,
      userDataWritable: () => true
    })
    expect(report.components.find((c) => c.id === 'sandbox')).toMatchObject({ ok: state === 'ready', installable })
    expect(autoInstallPlan(report).map((c) => c.id)).toEqual(installable ? ['sandbox'] : [])
  })

  it.each([
    ['win32', false, false, 'unsupported'],
    ['darwin', true, false, 'unsupported'],
    ['win32', true, true, 'policyDisabled']
  ] as const)('respeta plataforma, disponibilidad y política (%s, %s, %s)', async (platform, available, disabled, state) => {
    const run = vi.fn()
    const sandbox = await readStartupSandbox({ platform, available, policyDisabled: () => disabled, run })
    expect(sandbox.state).toBe(state)
    expect(run).not.toHaveBeenCalled()
  })
})
