/** Sin aislamiento (`noSandbox` de depuración o plataformas sin backend): lanza `opencode serve` directamente. */
import { spawnOnHost } from './spawn'
import type { SandboxBackend } from './types'

export const noneBackend: SandboxBackend = {
  id: 'none',
  async status() {
    return { state: 'unsupported' }
  },
  async launch(spec) {
    const env = { ...spec.baseEnv, ...spec.extraEnv }
    const child = spawnOnHost(spec.bin, spec.serveArgs, spec.folder, env)
    return { child, toHostPath: (p) => p, toSandboxPath: (p) => p, dispose: async () => {} }
  }
}
