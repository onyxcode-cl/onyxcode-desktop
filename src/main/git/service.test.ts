/**
 * Git real (binario del sistema) sobre un repo temporal: diff staged de un archivo renombrado (F7-B24).
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync, renameSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { GitError, commit, diff, status } from './service'

let dir: string
const g = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' })

beforeAll(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-git-')))
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

describe('guardar todo no incluye archivos de secretos', () => {
  it('un .env nuevo y un archivo normal: solo entra el normal', async () => {
    writeFileSync(join(dir, 'normal.txt'), 'hola\n')
    writeFileSync(join(dir, '.env'), 'CLAVE=valor-de-prueba\n')
    const res = await commit(dir, 'prueba', true)
    expect(res.hash).toMatch(/^[0-9a-f]{40}$/)
    const archivos = g('show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean)
    expect(archivos).toContain('normal.txt')
    expect(archivos).not.toContain('.env')
    // Sigue como archivo sin seguimiento: no se perdió ni se borró.
    expect(existsSync(join(dir, '.env'))).toBe(true)
    expect(g('status', '--porcelain')).toContain('?? .env')
  })
})

describe('guardar sin nada que guardar avisa en llano (no en inglés)', () => {
  it('solo hay un archivo de secretos: error claro, el archivo sigue ahí y no se crea commit', async () => {
    // `.env` quedó sin seguimiento en la prueba anterior.
    const antes = g('rev-parse', 'HEAD')
    const err = await commit(dir, 'prueba', true).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitError)
    expect((err as Error).message).toBe('No hay nada que guardar. Los archivos de secretos (como .env) no se incluyen en los commits.')
    expect((err as Error).message).not.toMatch(/nothing added|untracked/i)
    expect(g('rev-parse', 'HEAD')).toBe(antes)
    expect(existsSync(join(dir, '.env'))).toBe(true)
  })
  it('árbol limpio, con y sin «guardar todo»: «No hay nada que guardar.»', async () => {
    rmSync(join(dir, '.env'), { force: true })
    for (const all of [true, false]) {
      const err = await commit(dir, 'prueba', all).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(GitError)
      expect((err as Error).message).toBe('No hay nada que guardar.')
    }
  })
  it('con algo preparado sí guarda', async () => {
    writeFileSync(join(dir, 'otro.txt'), 'z\n')
    g('add', 'otro.txt')
    expect((await commit(dir, 'otro')).hash).toMatch(/^[0-9a-f]{40}$/)
  })
})
