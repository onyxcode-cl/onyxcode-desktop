import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as service from './service'
import { execSafeGit } from './safe-git'
import { dirtyPaths } from '../compare/git'
import { runGit } from '../pr/git'

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return { ...actual, execFile: vi.fn(actual.execFile) }
})
import { execFile } from 'node:child_process'

const roots: string[] = []
const previousGlobal = process.env.GIT_CONFIG_GLOBAL
afterEach(() => {
  vi.restoreAllMocks()
  if (previousGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL
  else process.env.GIT_CONFIG_GLOBAL = previousGlobal
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Git de la app con configuración local hostil', () => {
  it('consulta referencias y remotos y transfiere sin ejecutar programas locales ni recurrir a submódulos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-git-remotos-'))
    roots.push(dir)
    process.env.GIT_CONFIG_GLOBAL = join(dir, 'global')
    writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
    const g = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: 'pipe' }).trim()
    g('init', '-q', '-b', 'main')
    g('config', 'user.name', 'Prueba')
    g('config', 'user.email', 'prueba@example.invalid')
    writeFileSync(join(dir, 'a.dat'), 'contenido\n')
    writeFileSync(join(dir, '.gitattributes'), '*.dat filter=trampa diff=trampa\n')
    writeFileSync(join(dir, '.gitignore'), 'ignorado\n')
    g('add', '--', 'a.dat', '.gitattributes', '.gitignore')
    g('commit', '-qm', 'inicial')
    const head = g('rev-parse', 'HEAD')
    g('init', '-q', '--bare', 'origin.git')
    g('remote', 'add', 'origin', join(dir, 'origin.git'))
    const sentinel = join(dir, 'centinela.txt')
    const program = join(dir, 'trampa')
    writeFileSync(program, `#!/bin/sh\necho trampa >> '${sentinel}'\ncat\n`)
    chmodSync(program, 0o755)
    for (const key of [
      'core.fsmonitor',
      'core.sshCommand',
      'core.askPass',
      'filter.trampa.clean',
      'filter.trampa.smudge',
      'filter.trampa.process',
      'credential.helper',
      'diff.trampa.textconv'
    ])
      g('config', key, program)
    g('config', 'fetch.recurseSubmodules', 'true')
    g('config', 'push.recurseSubmodules', 'on-demand')
    const calls = vi.mocked(execFile)
    calls.mockClear()
    const safe = async (args: string[]): Promise<string> => {
      const r = await execSafeGit(args, { cwd: dir })
      expect(r.error, r.stderr.toString()).toBeNull()
      expect(existsSync(sentinel)).toBe(false)
      return r.stdout.toString().trim()
    }
    expect(await safe(['symbolic-ref', '--short', 'HEAD'])).toBe('main')
    expect(await safe(['merge-base', 'HEAD', 'HEAD'])).toBe(head)
    expect(await safe(['cat-file', '-p', 'HEAD:a.dat'])).toBe('contenido')
    expect(await safe(['check-ignore', '--', 'ignorado'])).toBe('ignorado')
    expect(await safe(['rev-list', '--count', 'HEAD'])).toBe('1')
    expect(await safe(['show-ref', '--verify', 'refs/heads/main'])).toContain(head)
    expect(await safe(['remote', 'get-url', 'origin'])).toBe(join(dir, 'origin.git'))
    await safe(['push', '--', 'origin', 'refs/heads/main:refs/heads/main'])
    expect(await safe(['ls-remote', '--heads', 'origin'])).toContain(head)
    await safe(['fetch', '--', 'origin'])
    for (const [, args] of calls.mock.calls) {
      expect(args).toEqual(expect.arrayContaining(['core.fsmonitor=false', 'core.sshCommand=', 'core.askPass=', 'submodule.recurse=false']))
      if (args?.includes('push') || args?.includes('fetch')) expect(args).toContain('--no-recurse-submodules')
      expect(args).not.toContain('--no-verify')
    }
  })

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

it('incluidos, stash, mezcla, alias y nombres Unicode', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lzx-git-vuelta2-'))
  roots.push(dir)
  process.env.GIT_CONFIG_GLOBAL = join(dir, 'global')
  writeFileSync(process.env.GIT_CONFIG_GLOBAL, '')
  const g = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
  g('init', '-q', '-b', 'base')
  g('config', 'user.name', 'Prueba')
  g('config', 'user.email', 'p@example.invalid')
  writeFileSync(join(dir, 'año.txt'), 'base\n')
  writeFileSync(join(dir, '😀.txt'), 'emoji\n')
  writeFileSync(join(dir, '.gitattributes'), '*.txt merge=trampa filter=trampa diff=trampa\n')
  g('add', '.')
  g('commit', '-qm', 'base')
  g('branch', 'otra')
  writeFileSync(join(dir, 'año.txt'), 'primera\n')
  g('add', '.')
  g('commit', '-qm', 'primera')
  g('switch', '-q', 'otra')
  writeFileSync(join(dir, 'año.txt'), 'segunda\n')
  g('add', '.')
  g('commit', '-qm', 'segunda')
  g('switch', '-q', 'base')
  const sentinel = join(dir, 'centinela.txt')
  const program = join(dir, 'programa')
  writeFileSync(program, `#!/bin/sh\necho activado >> '${sentinel}'\ncat\n`)
  chmodSync(program, 0o755)
  writeFileSync(join(dir, 'incluido'), `[filter "trampa"]\n clean = ${program}\n`)
  g('config', 'include.path', join(dir, 'incluido'))
  for (const key of [
    'merge.trampa.driver',
    'diff.trampa.command',
    'diff.trampa.textconv',
    'mergetool.trampa.cmd',
    'difftool.trampa.cmd',
    'core.editor',
    'sequence.editor',
    'core.gitProxy',
    'credential.helper',
    'uploadpack.packObjectsHook',
    'core.alternateRefsCommand',
    'gpg.program',
    'gpg.ssh.program'
  ])
    g('config', key, program)
  g('config', 'alias.atacar', `!${program}`)
  const safe = (args: string[]) => execSafeGit(args, { cwd: dir })
  writeFileSync(join(dir, '😀.txt'), 'cambio\n')
  expect((await service.status(dir)).files.some((f) => JSON.stringify(f).includes('😀'))).toBe(true)
  await service.commit(dir, 'unicode', true)
  expect(g('ls-tree', '-z', '--name-only', 'HEAD')).toContain('año.txt')
  writeFileSync(join(dir, 'año.txt'), 'temporal\n')
  expect((await safe(['stash', 'push', '-m', 'temporal'])).error).toBeNull()
  const merge = await safe(['merge', '--no-edit', 'otra'])
  expect(merge.error).not.toBeNull() // el driver seguro informa conflicto, no ejecuta el del repositorio
  expect(existsSync(sentinel)).toBe(false)
  await expect(safe(['atacar'])).rejects.toThrow('no permitido')
  writeFileSync(join(dir, '.gitmodules'), `[submodule "trampa"]\n path = trampa\n url = ./no-existe\n update = !${program}\n`)
  await expect(safe(['submodule', 'update', '--recursive'])).rejects.toThrow('submódulos')
  await expect(safe(['fetch', '--recurse-submodules'])).rejects.toThrow('submódulos')
  expect(existsSync(sentinel)).toBe(false)
})
