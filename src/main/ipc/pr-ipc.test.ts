/** Contrato, esquemas estrictos y clase del celular de los canales `pr:*` (rama → subir → pull request → revisión). */
import { describe, expect, it } from 'vitest'
import { CODE_INVOKE_CHANNELS } from '@shared/ipc-code'
import { CELULAR_POLICY, decide } from '../remote/policy'
import { CHANNEL_ROLES, IPC_SCHEMAS } from './schemas'

const PR_CHANNELS = CODE_INVOKE_CHANNELS.filter((c) => c.startsWith('pr:'))
const CWD = '/Users/x/proyecto'
const SHA = 'a'.repeat(40)

const V = (ch: string): ((v: unknown) => unknown) => (IPC_SCHEMAS as unknown as Record<string, (v: unknown) => unknown>)[ch]

describe('canales pr:*', () => {
  it('existen los once y todos tienen esquema', () => {
    expect(PR_CHANNELS.sort()).toEqual(
      [
        'pr:changes',
        'pr:create',
        'pr:createBranch',
        'pr:gh',
        'pr:postReview',
        'pr:push',
        'pr:pushPlan',
        'pr:reviewInfo',
        'pr:status',
        'pr:view',
        'pr:workDiff'
      ].sort()
    )
    for (const c of PR_CHANNELS) expect(typeof V(c), c).toBe('function')
  })

  it('solo la ventana principal los invoca (ninguna secundaria tiene rol)', () => {
    for (const role of Object.values(CHANNEL_ROLES)) for (const c of PR_CHANNELS) expect(role.has(c), c).toBe(false)
  })

  it('el celular los tiene prohibidos (clase X), con cualquier carga', () => {
    for (const c of PR_CHANNELS) {
      expect(CELULAR_POLICY[c], c).toBe('X')
      const d = decide(
        { kind: 'ipc', channel: c, payload: { cwd: CWD } } as never,
        {
          allowedDirs: [CWD],
          chatDirs: [],
          fullAccessDirs: [],
          knownModels: new Set(),
          permissionKind: () => undefined,
          isDirectory: () => true
        } as never
      )
      expect('allow' in d && d.allow, c).toBe(false)
    }
  })

  it('claves inesperadas → rechazo (esquema estricto)', () => {
    expect(() => V('pr:status')({ cwd: CWD, extra: 1 })).toThrow()
    expect(() => V('pr:push')({ cwd: CWD, remote: 'origin', branch: 'feat/a', expectHead: SHA, force: true })).toThrow()
    expect(() => V('pr:create')({ cwd: CWD })).toThrow()
  })

  it('cwd debe ser una ruta absoluta', () => {
    expect(() => V('pr:status')({ cwd: 'relativa/x' })).toThrow()
    expect(() => V('pr:status')({ cwd: '' })).toThrow()
    expect(V('pr:status')({ cwd: CWD })).toEqual({ cwd: CWD })
  })

  describe('lista blanca de ramas y remotos', () => {
    const bad = ['--force', '-d', 'a b', 'a;b', 'a$(id)', 'a`id`', 'a\nb', 'a..b', 'x.lock', '', 'ñ', '/abs', 'a'.repeat(101)]
    it.each(bad)('pr:createBranch rechaza %j', (name) => {
      expect(() => V('pr:createBranch')({ cwd: CWD, name })).toThrow()
    })
    it('pr:createBranch acepta un nombre normal', () => {
      expect(V('pr:createBranch')({ cwd: CWD, name: 'feat/login-2' })).toEqual({ cwd: CWD, name: 'feat/login-2' })
    })
    it.each(['', '--mirror', 'https://x.test/r.git', '../o', 'a b', 'a/b', '-o'])('remoto %j rechazado', (remote) => {
      expect(() => V('pr:pushPlan')({ cwd: CWD, remote })).toThrow()
    })
    it('pr:push exige punta de 40+ hex y la rama válida', () => {
      const ok = { cwd: CWD, remote: 'origin', branch: 'feat/a', expectHead: SHA }
      expect(V('pr:push')(ok)).toEqual(ok)
      expect(() => V('pr:push')({ ...ok, expectHead: 'HEAD' })).toThrow()
      expect(() => V('pr:push')({ ...ok, expectHead: 'g'.repeat(40) })).toThrow()
      expect(() => V('pr:push')({ ...ok, branch: '+refs/heads/x' })).toThrow()
      expect(() => V('pr:push')({ ...ok, branch: '--force' })).toThrow()
    })
  })

  describe('textos', () => {
    const ok = {
      cwd: CWD,
      remote: 'origin',
      title: 'T',
      body: 'cuerpo\ncon líneas',
      base: 'main',
      draft: false,
      branch: 'feat/a',
      expectHead: SHA
    }
    it('pr:create valida título (una línea) y cuerpo (sin nulos)', () => {
      expect(V('pr:create')(ok)).toEqual(ok)
      expect(() => V('pr:create')({ ...ok, title: 'a\nb' })).toThrow()
      expect(() => V('pr:create')({ ...ok, title: '' })).toThrow()
      expect(() => V('pr:create')({ ...ok, title: 'x'.repeat(257) })).toThrow()
      expect(() => V('pr:create')({ ...ok, body: 'a\0b' })).toThrow()
      expect(() => V('pr:create')({ ...ok, base: '--base' })).toThrow()
      expect(() => V('pr:create')({ ...ok, draft: 'si' })).toThrow()
    })
    it('pr:reviewInfo solo acepta número o enlace de GitHub', () => {
      for (const ref of ['12', '#12', 'https://github.com/o/r/pull/12'])
        expect(V('pr:reviewInfo')({ cwd: CWD, remote: 'origin', ref })).toBeTruthy()
      for (const ref of ['', 'abc', '12; id', '--repo x', 'https://gitlab.com/o/r/pull/1', 'http://github.com/o/r/pull/1'])
        expect(() => V('pr:reviewInfo')({ cwd: CWD, remote: 'origin', ref }), ref).toThrow()
    })
    it('pr:postReview acota comentarios y líneas', () => {
      const ok2 = { cwd: CWD, remote: 'origin', number: 3, headSha: SHA, summary: 'x', comments: [{ path: 'a.ts', line: 3, body: 'c' }] }
      expect(V('pr:postReview')(ok2)).toEqual(ok2)
      expect(() => V('pr:postReview')({ ...ok2, number: 0 })).toThrow()
      expect(() => V('pr:postReview')({ ...ok2, comments: Array.from({ length: 31 }, () => ok2.comments[0]) })).toThrow()
      expect(() => V('pr:postReview')({ ...ok2, comments: [{ path: 'a.ts', line: -1, body: 'c' }] })).toThrow()
      expect(() => V('pr:postReview')({ ...ok2, comments: [{ path: 'a.ts', line: 1, body: 'c', event: 'APPROVE' }] })).toThrow()
      expect(() => V('pr:postReview')({ ...ok2, summary: 'x'.repeat(20_001) })).toThrow()
    })
  })
})
