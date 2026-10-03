import { describe, expect, it } from 'vitest'
import { ONCE_SAFE_PERMISSIONS, needsMacConfirm } from '../../shared/remote/mac-confirm'
import { decide, ONCE_SAFE_PERMISSIONS as POLICY_ONCE_SAFE, type PolicyContext } from './policy'

describe('mac-confirm coincide con la política real del celular (policy.ts)', () => {
  const dir = '/Users/ana/proyecto'
  const ctx: PolicyContext = {
    allowedDirs: [dir],
    isDirectory: (p) => p.endsWith('/carpeta'),
    sessionDir: () => dir,
    permissionKind: (id) => id.replace(/^req_/, '')
  }
  const confirm = (r: Parameters<typeof decide>[0]): boolean => 'confirm' in decide(r, ctx)

  it('el conjunto de permisos «una vez» es el mismo', () => {
    expect([...ONCE_SAFE_PERMISSIONS].sort()).toEqual([...POLICY_ONCE_SAFE].sort())
  })
  it('git:discard', () => {
    const run = (n: number, scope?: string): boolean =>
      confirm({
        kind: 'ipc',
        channel: 'git:discard',
        payload: { cwd: dir, paths: Array.from({ length: n }, (_, i) => `f${i}.ts`), scope }
      })
    expect(run(1, 'unstaged')).toBe(needsMacConfirm({ kind: 'git.discard', files: 1 }))
    expect(run(21, 'unstaged')).toBe(needsMacConfirm({ kind: 'git.discard', files: 21 }))
    expect(run(1, 'all')).toBe(needsMacConfirm({ kind: 'git.discard', files: 1, all: true }))
  })
  it('files:trash y files:rename', () => {
    expect(confirm({ kind: 'ipc', channel: 'files:trash', payload: { cwd: dir, path: 'a.ts' } })).toBe(
      needsMacConfirm({ kind: 'files.trash', isDirectory: false })
    )
    expect(confirm({ kind: 'ipc', channel: 'files:trash', payload: { cwd: dir, path: 'carpeta' } })).toBe(
      needsMacConfirm({ kind: 'files.trash', isDirectory: true })
    )
    expect(confirm({ kind: 'ipc', channel: 'files:rename', payload: { cwd: dir, path: 'a.ts', name: 'b.ts' } })).toBe(
      needsMacConfirm({ kind: 'files.rename', isDirectory: false })
    )
    expect(confirm({ kind: 'ipc', channel: 'files:rename', payload: { cwd: dir, path: 'carpeta', name: 'otra' } })).toBe(
      needsMacConfirm({ kind: 'files.rename', isDirectory: true })
    )
  })
  it('git:removeWorktree', () => {
    expect(confirm({ kind: 'ipc', channel: 'git:removeWorktree', payload: { cwd: dir, path: `${dir}/wt` } })).toBe(
      needsMacConfirm({ kind: 'git.removeWorktree' })
    )
  })
  it('permission.reply «una vez» según el tipo de permiso; «siempre» se deniega', () => {
    for (const kind of ['edit', 'bash', 'external_directory', 'doom_loop', 'desconocido']) {
      const r = decide(
        {
          kind: 'http',
          method: 'POST',
          path: `/permission/req_${kind}/reply`,
          query: { directory: dir },
          body: { reply: 'once' }
        },
        ctx
      )
      expect('confirm' in r).toBe(needsMacConfirm({ kind: 'permission.once', permission: kind }))
      expect('allow' in r && r.allow === false).toBe(false)
    }
    const always = decide(
      { kind: 'http', method: 'POST', path: '/permission/req_edit/reply', query: { directory: dir }, body: { reply: 'always' } },
      ctx
    )
    expect(always).toMatchObject({ allow: false })
  })
})
