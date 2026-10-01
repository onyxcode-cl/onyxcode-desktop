/**
 * Descartar cambios (R2-A): git real sobre repos temporales. Papelera de pruebas = carpeta temporal
 * (`trashToDir`), así se comprueba que lo nuevo NO se borra sino que se mueve.
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { trashToDir } from '../tasks/trash'
import { discardChanges, status, undoDiscard, type DiscardDeps } from './service'

let base: string
let repo: string
let deps: DiscardDeps
let trashDir: string
const g = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })
const w = (rel: string, body: string): void => {
  mkdirSync(join(repo, rel, '..'), { recursive: true })
  writeFileSync(join(repo, rel), body)
}
const r = (rel: string): string => readFileSync(join(repo, rel), 'utf8')
const trashed = (): string[] => (existsSync(trashDir) ? readdirSync(trashDir) : [])

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-discard-')))
  repo = join(base, 'repo')
  mkdirSync(repo)
  trashDir = join(base, 'trash')
  deps = { trash: trashToDir(trashDir), backupDir: join(base, 'backup') }
  g('init', '-q')
  g('config', 'user.email', 't@t.t')
  g('config', 'user.name', 't')
  g('config', 'commit.gpgsign', 'false')
  w('a.txt', 'original a\n')
  w('src/b.txt', 'original b\n')
  w('keep.txt', 'keep\n')
  w('.gitignore', 'ignored.log\n')
  g('add', '-A')
  g('commit', '-q', '-m', 'init')
})
afterEach(() => rmSync(base, { recursive: true, force: true }))

describe('discardChanges', () => {
  it('restaura un archivo modificado (índice y árbol) y deja los demás', async () => {
    w('a.txt', 'cambiado\n')
    g('add', 'a.txt')
    w('a.txt', 'cambiado otra vez\n')
    w('src/b.txt', 'b tocado\n')
    const res = await discardChanges(repo, ['a.txt'], deps)
    expect(res.restored).toEqual(['a.txt'])
    expect(r('a.txt')).toBe('original a\n')
    expect(r('src/b.txt')).toBe('b tocado\n')
    expect((await status(repo)).files.map((f) => f.path)).toEqual(['src/b.txt'])
  })

  it('restaura un archivo borrado y acepta rutas absolutas dentro del repo', async () => {
    rmSync(join(repo, 'src/b.txt'))
    const res = await discardChanges(repo, [join(repo, 'src/b.txt')], deps)
    expect(res.restored).toEqual(['src/b.txt'])
    expect(r('src/b.txt')).toBe('original b\n')
  })

  it('un archivo nuevo sin seguimiento va a la Papelera, no se borra', async () => {
    w('nuevo.txt', 'contenido valioso\n')
    const res = await discardChanges(repo, ['nuevo.txt'], deps)
    expect(res.trashed).toEqual(['nuevo.txt'])
    expect(existsSync(join(repo, 'nuevo.txt'))).toBe(false)
    const t = trashed()
    expect(t).toHaveLength(1)
    expect(readFileSync(join(trashDir, t[0]), 'utf8')).toBe('contenido valioso\n')
    expect(res.undoId).toBeNull()
  })

  it('un archivo añadido al índice sale del índice y va a la Papelera', async () => {
    w('anadido.txt', 'x\n')
    g('add', 'anadido.txt')
    w('anadido.txt', 'x modificado\n')
    const res = await discardChanges(repo, ['anadido.txt'], deps)
    expect(res.trashed).toEqual(['anadido.txt'])
    expect(g('status', '--porcelain')).toBe('')
    expect(readFileSync(join(trashDir, trashed()[0]), 'utf8')).toBe('x modificado\n')
  })

  it('un renombre staged vuelve al nombre original', async () => {
    g('mv', 'a.txt', 'renombrado.txt')
    const res = await discardChanges(repo, ['renombrado.txt'], deps)
    expect(res.failed).toEqual([])
    expect(r('a.txt')).toBe('original a\n')
    expect(existsSync(join(repo, 'renombrado.txt'))).toBe(false)
    expect(g('status', '--porcelain')).toBe('')
    expect(trashed()).toHaveLength(1)
  })

  it('rechaza rutas fuera del repo, con .., la raíz y .git sin tocar nada', async () => {
    w('a.txt', 'cambiado\n')
    const outside = join(base, 'fuera.txt')
    writeFileSync(outside, 'fuera\n')
    for (const bad of [outside, '/etc/hosts', '../fuera.txt', 'src/../../fuera.txt', '.', '', '.git/config', join(repo, '.git', 'HEAD')]) {
      await expect(discardChanges(repo, [bad], deps), bad).rejects.toThrow()
    }
    expect(readFileSync(outside, 'utf8')).toBe('fuera\n')
    expect(r('a.txt')).toBe('cambiado\n')
    expect(trashed()).toEqual([])
  })

  it('todo o nada: si una ruta no es válida no se descarta ninguna', async () => {
    w('a.txt', 'cambiado\n')
    await expect(discardChanges(repo, ['a.txt', '../fuera.txt'], deps)).rejects.toThrow()
    await expect(discardChanges(repo, ['a.txt', 'keep.txt'], deps)).rejects.toThrow() // keep.txt no tiene cambios
    expect(r('a.txt')).toBe('cambiado\n')
  })

  it('rechaza archivos sin cambios e ignorados', async () => {
    w('ignored.log', 'log\n')
    await expect(discardChanges(repo, ['keep.txt'], deps)).rejects.toThrow()
    await expect(discardChanges(repo, ['ignored.log'], deps)).rejects.toThrow()
    expect(r('ignored.log')).toBe('log\n')
  })

  it('un enlace simbólico sin seguimiento: se mueve el enlace, nunca el destino', async () => {
    const target = join(base, 'secreto.txt')
    writeFileSync(target, 'no tocar\n')
    symlinkSync(target, join(repo, 'enlace'))
    const res = await discardChanges(repo, ['enlace'], deps)
    expect(res.trashed).toEqual(['enlace'])
    expect(readFileSync(target, 'utf8')).toBe('no tocar\n')
    expect(existsSync(join(repo, 'enlace'))).toBe(false)
    expect(lstatSync(join(trashDir, trashed()[0])).isSymbolicLink()).toBe(true)
  })

  it('rechaza rutas que atraviesan una carpeta enlazada fuera del repo', async () => {
    const outDir = join(base, 'otra')
    mkdirSync(outDir)
    writeFileSync(join(outDir, 'x.txt'), 'x\n')
    symlinkSync(outDir, join(repo, 'link'))
    await expect(discardChanges(repo, ['link/x.txt'], deps)).rejects.toThrow()
    expect(readFileSync(join(outDir, 'x.txt'), 'utf8')).toBe('x\n')
  })

  it('rechaza más archivos que el máximo y listas vacías', async () => {
    await expect(discardChanges(repo, [], deps)).rejects.toThrow()
    await expect(
      discardChanges(
        repo,
        Array.from({ length: 201 }, (_, i) => `f${i}`),
        deps
      )
    ).rejects.toThrow()
  })

  it('rechaza archivos en conflicto', async () => {
    g('checkout', '-q', '-b', 'otra')
    w('a.txt', 'rama otra\n')
    g('commit', '-qam', 'otra')
    g('checkout', '-q', '-')
    w('a.txt', 'rama main\n')
    g('commit', '-qam', 'main')
    try {
      g('merge', 'otra')
    } catch {
      // conflicto esperado
    }
    await expect(discardChanges(repo, ['a.txt'], deps)).rejects.toThrow()
    expect(r('a.txt')).toContain('<<<<<<<')
  })

  it('repo sin commits: lo añadido y lo nuevo van a la Papelera', async () => {
    const fresh = join(base, 'fresh')
    mkdirSync(fresh)
    execFileSync('git', ['init', '-q'], { cwd: fresh })
    writeFileSync(join(fresh, 'n.txt'), 'n\n')
    writeFileSync(join(fresh, 'm.txt'), 'm\n')
    execFileSync('git', ['add', 'm.txt'], { cwd: fresh })
    const res = await discardChanges(fresh, ['n.txt', 'm.txt'], deps)
    expect(res.trashed.sort()).toEqual(['m.txt', 'n.txt'])
    expect(existsSync(join(fresh, 'n.txt'))).toBe(false)
    expect(existsSync(join(fresh, 'm.txt'))).toBe(false)
  })

  it('si falla la Papelera informa del fallo y no pierde el archivo', async () => {
    w('nuevo.txt', 'x\n')
    const res = await discardChanges(repo, ['nuevo.txt'], {
      ...deps,
      trash: async () => {
        throw new Error('sin permiso')
      }
    })
    expect(res.failed[0].path).toBe('nuevo.txt')
    expect(r('nuevo.txt')).toBe('x\n')
  })
})

describe('undoDiscard («Rehacer»)', () => {
  it('devuelve el contenido descartado, incluidos modo y archivos borrados', async () => {
    w('a.txt', 'trabajo valioso\n')
    rmSync(join(repo, 'src/b.txt'))
    const res = await discardChanges(repo, ['a.txt', 'src/b.txt'], deps)
    expect(res.undoId).toMatch(/^[0-9a-f-]{36}$/)
    expect(r('a.txt')).toBe('original a\n')
    const back = await undoDiscard(repo, res.undoId!, deps)
    expect(back.failed).toEqual([])
    expect(r('a.txt')).toBe('trabajo valioso\n')
    expect(existsSync(join(repo, 'src/b.txt'))).toBe(false)
    // El copia se consume: no se puede rehacer dos veces.
    await expect(undoDiscard(repo, res.undoId!, deps)).rejects.toThrow()
  })

  it('no pisa un archivo que cambió después del descarte', async () => {
    w('a.txt', 'trabajo valioso\n')
    const res = await discardChanges(repo, ['a.txt'], deps)
    w('a.txt', 'edición nueva\n')
    const back = await undoDiscard(repo, res.undoId!, deps)
    expect(back.restored).toEqual([])
    expect(back.failed).toHaveLength(1)
    expect(r('a.txt')).toBe('edición nueva\n')
  })

  it('rechaza ids inválidos, inexistentes o de otro repo', async () => {
    await expect(undoDiscard(repo, '../../etc', deps)).rejects.toThrow()
    await expect(undoDiscard(repo, '00000000-0000-0000-0000-000000000000', deps)).rejects.toThrow()
    w('a.txt', 'v\n')
    const res = await discardChanges(repo, ['a.txt'], deps)
    const other = join(base, 'other')
    mkdirSync(other)
    execFileSync('git', ['init', '-q'], { cwd: other })
    await expect(undoDiscard(other, res.undoId!, deps)).rejects.toThrow()
  })

  it('un renombre descartado no ofrece «Rehacer» (lo nuevo va a la Papelera)', async () => {
    g('mv', 'a.txt', 'z.txt')
    const res = await discardChanges(repo, ['z.txt'], deps)
    expect(res.undoId).toBeNull()
  })
})
