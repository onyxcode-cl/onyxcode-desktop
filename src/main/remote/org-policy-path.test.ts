import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  delete process.env.ONYXCODE_MANAGED_POLICY
  vi.resetModules()
  vi.doUnmock('electron')
})

async function pathWith(isPackaged: boolean): Promise<{ file: string; system: string }> {
  vi.resetModules()
  vi.doMock('electron', () => ({ app: { isPackaged } }))
  const m = await import('../tasks/policy')
  return { file: m.policyFile(), system: m.managedPolicyPath() }
}

describe('ruta de la política de la organización', () => {
  it('app empaquetada: se ignora la variable de entorno (solo vale la ruta del sistema)', async () => {
    process.env.ONYXCODE_MANAGED_POLICY = '/tmp/falsa.json'
    const { file, system } = await pathWith(true)
    expect(file).toBe(system)
  })
  it('en desarrollo la variable sí puede forzar otra ruta', async () => {
    process.env.ONYXCODE_MANAGED_POLICY = '/tmp/dev-policy.json'
    expect((await pathWith(false)).file).toBe('/tmp/dev-policy.json')
  })
})
