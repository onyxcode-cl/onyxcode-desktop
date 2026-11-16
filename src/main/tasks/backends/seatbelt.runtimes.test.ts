import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ dirs: [] as string[] }))
vi.mock('electron', () => ({ app: {} }))
vi.mock('../../runtimes/engine-env', () => ({ appRuntimeReadOnlyDirs: () => state.dirs }))
import { seatbeltProfileText } from './seatbelt'

describe('runtimes de Overdrive dentro de Seatbelt', () => {
  it('añade solo lectura de las versiones verificadas y conserva la denegación de userData', () => {
    const userData = join(tmpdir(), 'lzx-runtime-profile', 'userData')
    const config = join(userData, 'opencode-config')
    const node = join(userData, 'runtimes/node-1')
    const uv = join(userData, 'runtimes/uv-1')
    const profile = (): string =>
      seatbeltProfileText(
        join(tmpdir(), 'project'),
        {
          userData,
          privateDir: join(userData, 'tasks-sandbox/key')
        },
        config
      )
    state.dirs = []
    const missing = profile()
    expect(missing).not.toContain(`(subpath "${node}")`)
    state.dirs = [node, uv]
    const installed = profile()
    expect(installed).toContain(`(allow file-read* (subpath "${config}") (subpath "${node}") (subpath "${uv}"))`)
    expect(installed).toContain(`(deny file-read* file-write* (subpath "${userData}"))`)
    expect(installed).not.toContain(`(allow file-read* file-write* (subpath "${node}")`)
    // Las únicas diferencias son dos subrutas en la concesión de lectura existente.
    expect(installed.replace(` (subpath "${node}") (subpath "${uv}")`, '')).toBe(missing)
    state.dirs = []
  })
})
