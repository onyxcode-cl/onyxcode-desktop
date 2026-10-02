/**
 * Git real (binario del sistema) sobre un repo temporal: diff staged de un archivo renombrado (F7-B24).
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { diff, status } from './service'

let dir: string
const g = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-git-')))
  g('init', '-q')
  g('config', 'user.email', 't@t.t')
  g('config', 'user.name', 't')
  g('config', 'commit.gpgsign', 'false')
  g('config', 'core.autocrlf', 'false')
  writeFileSync(join(dir, 'old.txt'), Array.from({ length: 20 }, (_, i) => `linea ${i}`).join('\n') + '\n')
  writeFileSync(join(dir, 'other.txt'), 'x\n')
  g('add', '-A')
  g('commit', '-q', '-m', 'init')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('git diff --staged con renombrados', () => {
  it('incluye el path antiguo: se ve como renombrado, no como archivo nuevo', async () => {
    renameSync(join(dir, 'old.txt'), join(dir, 'new.txt'))
    writeFileSync(join(dir, 'new.txt'), Array.from({ length: 20 }, (_, i) => (i === 3 ? 'CAMBIADA' : `linea ${i}`)).join('\n') + '\n')
    g('add', '-A')
    const st = await status(dir)
    expect(st.files.find((f) => f.path === 'new.txt')?.origPath).toBe('old.txt')

    const patch = await diff({ cwd: dir, path: 'new.txt', staged: true })
    expect(patch).toContain('rename from old.txt')
    expect(patch).toContain('rename to new.txt')
    expect(patch).toContain('-linea 3')
    expect(patch).not.toContain('new file mode')
  })

  it('archivo no renombrado: diff normal, sin arrastrar otros', async () => {
    writeFileSync(join(dir, 'other.txt'), 'y\n')
    g('add', 'other.txt')
    const patch = await diff({ cwd: dir, path: 'other.txt', staged: true })
    expect(patch).toContain('-x')
    expect(patch).toContain('+y')
    expect(patch).not.toContain('new.txt')
  })
})

describe('hardening core.fsmonitor (F7-B28)', () => {
  it('status/diff no ejecutan el hook de fsmonitor del repo', async () => {
    const hook = join(dir, '..', `${basename(dir)}-hook.sh`).replace(/\\/g, '/')
    const marker = `${hook}.ran`
    writeFileSync(hook, `#!/bin/sh\ntouch "${marker}"\n`)
    chmodSync(hook, 0o755)
    g('config', 'core.fsmonitor', hook)
    try {
      await status(dir)
      await diff({ cwd: dir, staged: false })
      expect(existsSync(marker)).toBe(false)
    } finally {
      g('config', '--unset', 'core.fsmonitor')
      rmSync(hook, { force: true })
      rmSync(marker, { force: true })
    }
  })
})
