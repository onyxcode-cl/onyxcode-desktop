import { describe, expect, it, vi } from 'vitest'
import type { GitWorktreeDetailed } from '@shared/ipc-code'
import { appWorktreesOf, declareCodeFolder, revokeCodeFolder, type CodeTrustDeps } from './engine-trust-folders'

vi.mock('../git/service', () => ({ listWorktrees: vi.fn() }))
vi.mock('../opencode/engine-trust', () => ({ engineTrust: {} }))

const wt = (path: string, over: Partial<GitWorktreeDetailed> = {}): GitWorktreeDetailed =>
  ({ path, branch: null, head: '', main: false, bare: false, detached: false, locked: false, prunable: false, ...over }) as GitWorktreeDetailed

const LIST = [
  wt('/r/app', { main: true }),
  wt('/r/.app-worktrees/feat-x'),
  wt('/r/.app-worktrees/viejo', { prunable: true }),
  wt('/otro/lugar/a-mano'),
  wt('/r/.app-worktrees/sub/profundo')
]

function deps(list: GitWorktreeDetailed[] | Error = LIST): CodeTrustDeps & { declared: string[]; revoked: string[] } {
  const d = {
    declared: [] as string[],
    revoked: [] as string[],
    declare: async (x: string) => {
      d.declared.push(x)
      return 'ok' as const
    },
    revoke: async (x: string) => {
      d.revoked.push(x)
      return 'ok' as const
    },
    worktrees: async () => (list instanceof Error ? Promise.reject(list) : list)
  }
  return d
}

describe('árboles de trabajo de la app', () => {
  it('solo los de .<repo>-worktrees junto al repositorio principal (no el principal, ni los prunables, ni los hechos a mano)', () => {
    expect(appWorktreesOf(LIST)).toEqual(['/r/.app-worktrees/feat-x'])
    expect(appWorktreesOf([])).toEqual([])
  })
})

describe('declareCodeFolder / revokeCodeFolder', () => {
  it('declara la carpeta y sus árboles de trabajo de la app', async () => {
    const d = deps()
    expect(await declareCodeFolder('/r/app', d)).toBe(true)
    expect(d.declared).toEqual(['/r/app', '/r/.app-worktrees/feat-x'])
  })
  it('si git falla, la carpeta igual queda declarada', async () => {
    const d = deps(new Error('sin git'))
    expect(await declareCodeFolder('/r/app', d)).toBe(true)
    expect(d.declared).toEqual(['/r/app'])
  })
  it('si el motor no la acepta, devuelve false y no declara los árboles', async () => {
    const d = deps()
    d.declare = async () => 'failed'
    expect(await declareCodeFolder('/r/app', d)).toBe(false)
  })
  it('un motor sin la función (unsupported) cuenta como bien', async () => {
    const d = deps()
    d.declare = async () => 'unsupported'
    expect(await declareCodeFolder('/r/app', d)).toBe(true)
  })
  it('quitar la confianza quita también los árboles de trabajo', async () => {
    const d = deps()
    expect(await revokeCodeFolder('/r/app', d)).toBe(true)
    expect(d.revoked).toEqual(['/r/app', '/r/.app-worktrees/feat-x'])
  })
})
