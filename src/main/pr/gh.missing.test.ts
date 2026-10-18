/** Sin `gh` instalada: la interfaz recibe un estado claro y ninguna operación inventa nada. */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./exec', async (orig) => ({ ...(await orig<typeof import('./exec')>()), findGh: () => null }))

import { ghInfo, viewBranchPr } from './gh'

let base: string
let work: string

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'lzx-pr-nogh-')))
  work = join(base, 'work')
  mkdirSync(work)
  const run = (...a: string[]): void =>
    void execFileSync('git', a, { cwd: work, env: { ...process.env, GIT_CONFIG_GLOBAL: join(base, 'cfg'), GIT_CONFIG_NOSYSTEM: '1' } })
  writeFileSync(join(base, 'cfg'), '[user]\n\tname = P\n\temail = p@example.test\n[init]\n\tdefaultBranch = main\n')
  run('init', '-q')
  run('remote', 'add', 'origin', 'https://github.com/o/r.git')
})
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('gh no instalada', () => {
  it('el estado es «missing» y no se inventa ninguna cuenta', async () => {
    expect(await ghInfo(work, 'github.com')).toEqual({ state: 'missing', account: null })
  })
  it('consultar un PR lanza el error entendible con código gh-missing', async () => {
    process.env.GIT_CONFIG_GLOBAL = join(base, 'cfg')
    await expect(viewBranchPr(work, 'origin', 'feat/x')).rejects.toMatchObject({ code: 'gh-missing' })
    delete process.env.GIT_CONFIG_GLOBAL
  })
})
