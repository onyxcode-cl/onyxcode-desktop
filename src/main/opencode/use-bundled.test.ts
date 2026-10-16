import { describe, expect, it, vi } from 'vitest'
import type { OpencodeInfo } from '@shared/types'
import { useBundledEngine, type UseBundledDeps } from './use-bundled'

const info: OpencodeInfo = {
  found: true,
  path: '/app/opencode',
  source: 'bundled',
  version: '1.19.0',
  sdkVersion: '1.19.0',
  compatible: true,
  bundledAvailable: true
}

function deps(over: Partial<UseBundledDeps> = {}): UseBundledDeps & { clear: ReturnType<typeof vi.fn> } {
  const clear = vi.fn()
  return {
    bundled: () => '/app/opencode',
    envBin: () => undefined,
    isExecutable: () => true,
    clearConfigured: clear,
    resolve: async () => ({ path: '/app/opencode', source: 'bundled' as const }),
    describe: async () => info,
    clear,
    ...over
  }
}

describe('useBundledEngine', () => {
  it('olvida la ruta elegida y devuelve el estado del motor incluido', async () => {
    const d = deps()
    expect(await useBundledEngine(d)).toEqual({ status: 'ok', info })
    expect(d.clear).toHaveBeenCalledTimes(1)
  })

  it('sin motor incluido (app sin empaquetar) no toca nada', async () => {
    const d = deps({ bundled: () => null })
    expect(await useBundledEngine(d)).toEqual({ status: 'unavailable' })
    expect(d.clear).not.toHaveBeenCalled()
  })

  it('con OPENCODE_BIN válido no puede cambiar y no toca los ajustes', async () => {
    const d = deps({ envBin: () => '/otro/opencode' })
    expect(await useBundledEngine(d)).toEqual({ status: 'pinned' })
    expect(d.clear).not.toHaveBeenCalled()
  })

  it('un OPENCODE_BIN inválido no estorba', async () => {
    const d = deps({ envBin: () => '/no/existe', isExecutable: () => false })
    expect((await useBundledEngine(d)).status).toBe('ok')
    expect(d.clear).toHaveBeenCalled()
  })
})
