import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as service from './service'
import { execSafeGit } from './safe-git'
import { dirtyPaths } from '../compare/git'
import { runGit } from '../pr/git'

const roots: string[] = []
const previousGlobal = process.env.GIT_CONFIG_GLOBAL
afterEach(() => {
  if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = previousGlobal
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Git de la app con configuración local hostil', () => {
  it('respeta LFS global y neutraliza una redefinición local', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-git-lfs-'))
    roots.push(dir)
    process.env.GIT_CONFIG_GLOBAL = join(dir, 'global')
    writeFileSync(process.env.GIT_CONFIG_GLOBAL, '[filter "lfs"]\n\tclean = cat\n')
    const g = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'pipe' })
    }
    g('init', '-q')
    const sentinel = join(dir, 'centinela.txt')
    const trap = join(dir, 'trampa')
    writeFileSync(trap, `#!/bin/sh\necho trampa >> '${sentinel}'\ncat\n`)
    chmodSync(trap, 0o755)
    g('config', 'filter.lfs.clean', trap)
    writeFileSync(join(dir, '.gitattributes'), '*.dat filter=lfs\n')
    writeFileSync(join(dir, 'a.dat'), 'contenido\n')
    const result = await execSafeGit(['add', 'a.dat'], { cwd: dir })
    expect(result.error).toBeNull()
    expect(existsSync(sentinel)).toBe(false)
    expect(execFileSync('git', ['show', ':a.dat'], { cwd: dir, encoding: 'utf8' })).toBe('contenido\n')
  })

  it('solo ejecuta el gancho cuando se habilita y mantiene bloqueados los demás programas', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-git-seguro-'))
    roots.push(dir)
    process.env.GIT_CONFIG_GLOBAL = join(dir, 'global')
    writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
    const g = (...args: string[]): void => {
      execFileSync('git', args, { cwd: dir, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'pipe' })
    }
    g('init', '-q')
    g('config', 'user.name', 'Prueba')
    g('config', 'user.email', 'prueba@example.invalid')
    writeFileSync(join(dir, 'a.txt'), 'primero\n')
    g('add', 'a.txt')
    g('commit', '-qm', 'inicial')
    const sentinel = join(dir, 'centinela.txt')
    const makeScript = (name: string, text: string, extra = ''): string => {
      const p = join(dir, name)
      writeFileSync(p, `#!/bin/sh\necho ${text} >> '${sentinel}'\n${extra}\n`)
      chmodSync(p, 0o755)
      return p
    }
    const hook = makeScript('gancho', 'gancho')
    const hooks = join(dir, 'hooks')
    g('config', 'core.hooksPath', hooks)
    const { mkdirSync, copyFileSync } = await import('node:fs')
    mkdirSync(hooks)
    copyFileSync(hook, join(hooks, 'pre-commit'))
    chmodSync(join(hooks, 'pre-commit'), 0o755)
    g('config', 'core.fsmonitor', makeScript('monitor', 'monitor'))
    g('config', 'diff.external', makeScript('diferencia', 'diff'))
    g('config', 'filter.trampa.clean', makeScript('filtro', 'filtro', 'cat'))
    writeFileSync(join(dir, '.gitattributes'), '*.txt filter=trampa\n')
    writeFileSync(join(dir, 'a.txt'), 'segundo\n')
    await service.status(dir)
    await dirtyPaths(dir)
    await runGit(dir, ['status', '--porcelain'])
    await service.diff({ cwd: dir })
    await service.commit(dir, 'segundo', true)
    expect(existsSync(sentinel)).toBe(false)
    writeFileSync(join(dir, 'a.txt'), 'tercero\n')
    await service.commit(dir, 'tercero', true, true)
    expect(readFileSync(sentinel, 'utf8')).toBe('gancho\n')
  })
})
