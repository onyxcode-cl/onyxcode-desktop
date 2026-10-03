/** Gestor de archivos: validación de nombres y rutas, sin sobrescribir, enlaces simbólicos y Papelera inyectada. */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { trashToDir } from '../tasks/trash'
import { createEntry, FileOpError, projectTarget, renameEntry, trashEntry, validateName } from './fs-ops'

describe('validateName', () => {
  it('acepta nombres normales', () => {
    for (const n of ['a.txt', 'README', '.env', 'carpeta nueva', 'ñandú.md', 'a'.repeat(255)]) expect(validateName(n)).toBe(n)
  })
  it.each(['', '.', '..', 'a/b', 'a\\b', 'a\0b', 'a\nb', 'x:y', ' a', 'a ', 'a.', '.git', '.GIT', 'CON', 'nul.txt', 'com1', 'LPT9.log'])(
    'rechaza %j',
    (n) => expect(() => validateName(n)).toThrow(FileOpError)
  )
  it('rechaza más de 255 bytes (UTF-8)', () => {
    expect(() => validateName('a'.repeat(256))).toThrow(FileOpError)
    expect(() => validateName('ñ'.repeat(128))).toThrow(FileOpError)
  })
  it('en Windows rechaza también < > " | ? *', () => {
    for (const c of '<>"|?*') {
      expect(() => validateName(`a${c}b`, 'win32')).toThrow(FileOpError)
      if (c !== ':') expect(validateName(`a${c}b`, 'darwin')).toBe(`a${c}b`)
    }
  })
  it('no es un tipo no-string', () => {
    expect(() => validateName(5)).toThrow(FileOpError)
  })
})

let root: string
let trashDir: string
beforeEach(() => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'onyx-fsops-')))
  root = join(base, 'proj')
  trashDir = join(base, 'trash')
  mkdirSync(join(root, 'src'), { recursive: true })
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, 'a.txt'), 'A')
  writeFileSync(join(root, 'src', 'b.txt'), 'B')
})

describe('projectTarget', () => {
  it('rechaza escapes, absolutas, .git y raíz', () => {
    for (const p of ['../x', 'src/../../x', '/etc/passwd', 'C:\\x', '.git/config', 'src/.GIT/x', 'a//b', './a', 'a/./b']) {
      expect(() => projectTarget(root, p), p).toThrow(FileOpError)
    }
    expect(() => projectTarget(root, '')).toThrow(FileOpError)
    expect(() => projectTarget(root, '.')).toThrow(FileOpError)
    expect(projectTarget(root, '.', { allowRoot: true }).abs).toBe(root)
  })
})

describe('createEntry', () => {
  it('crea archivo y carpeta (en la raíz y en subcarpetas)', () => {
    expect(createEntry(root, '.', 'n.txt', 'file')).toEqual({ path: 'n.txt' })
    expect(createEntry(root, 'src', 'sub', 'dir')).toEqual({ path: 'src/sub' })
    expect(createEntry(root, 'src/sub', 'x.md', 'file')).toEqual({ path: 'src/sub/x.md' })
    expect(readFileSync(join(root, 'n.txt'), 'utf8')).toBe('')
    expect(lstatSync(join(root, 'src', 'sub')).isDirectory()).toBe(true)
  })
  it('nunca sobrescribe', () => {
    expect(() => createEntry(root, '.', 'a.txt', 'file')).toThrow(/Ya existe/)
    expect(() => createEntry(root, '.', 'src', 'dir')).toThrow(/Ya existe/)
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('A')
  })
  it('rechaza .git, escapes, padre inexistente o que no es carpeta, y nombres con ruta', () => {
    expect(() => createEntry(root, '.git', 'x', 'file')).toThrow(FileOpError)
    expect(() => createEntry(root, '..', 'x', 'file')).toThrow(FileOpError)
    expect(() => createEntry(root, 'nope', 'x', 'file')).toThrow(/No existe/)
    expect(() => createEntry(root, 'a.txt', 'x', 'file')).toThrow(/no es una carpeta/)
    expect(() => createEntry(root, '.', '../x', 'file')).toThrow(FileOpError)
    expect(() => createEntry(root, '.', '.git', 'dir')).toThrow(FileOpError)
    expect(existsSync(join(root, '..', 'x'))).toBe(false)
  })
  it('no entra por un enlace simbólico a otra carpeta', () => {
    const out = join(root, '..', 'fuera')
    mkdirSync(out)
    symlinkSync(out, join(root, 'lnk'))
    expect(() => createEntry(root, 'lnk', 'x', 'file')).toThrow(FileOpError)
    expect(() => createEntry(root, 'lnk/sub', 'x', 'file')).toThrow(FileOpError)
    expect(existsSync(join(out, 'x'))).toBe(false)
  })
})

describe('renameEntry', () => {
  it('renombra archivo y carpeta', () => {
    expect(renameEntry(root, 'a.txt', 'z.txt')).toEqual({ path: 'z.txt' })
    expect(renameEntry(root, 'src', 'lib')).toEqual({ path: 'lib' })
    expect(readFileSync(join(root, 'lib', 'b.txt'), 'utf8')).toBe('B')
    expect(existsSync(join(root, 'a.txt'))).toBe(false)
  })
  it('nunca sobrescribe y no toca .git ni la raíz', () => {
    writeFileSync(join(root, 'c.txt'), 'C')
    expect(() => renameEntry(root, 'a.txt', 'c.txt')).toThrow(/Ya existe/)
    expect(readFileSync(join(root, 'c.txt'), 'utf8')).toBe('C')
    expect(() => renameEntry(root, '.git', 'x')).toThrow(FileOpError)
    expect(() => renameEntry(root, '.git/HEAD', 'x')).toThrow(FileOpError)
    expect(() => renameEntry(root, '.', 'x')).toThrow(FileOpError)
    expect(() => renameEntry(root, '', 'x')).toThrow(FileOpError)
    expect(() => renameEntry(root, 'a.txt', '.git')).toThrow(FileOpError)
    expect(() => renameEntry(root, 'a.txt', 'sub/x')).toThrow(FileOpError)
    expect(() => renameEntry(root, '../x', 'y')).toThrow(FileOpError)
    expect(() => renameEntry(root, 'nada', 'y')).toThrow(/No existe/)
  })
  it('mismo nombre: sin cambios', () => {
    expect(renameEntry(root, 'a.txt', 'a.txt')).toEqual({ path: 'a.txt' })
  })
  it('un enlace simbólico se mueve como enlace (no su destino)', () => {
    const out = join(root, '..', 'fuera.txt')
    writeFileSync(out, 'OUT')
    symlinkSync(out, join(root, 'ln'))
    renameEntry(root, 'ln', 'ln2')
    expect(readlinkSync(join(root, 'ln2'))).toBe(out)
    expect(readFileSync(out, 'utf8')).toBe('OUT')
  })
  it('no atraviesa enlaces simbólicos intermedios', () => {
    const out = join(root, '..', 'fuera')
    mkdirSync(out)
    writeFileSync(join(out, 'f.txt'), 'F')
    symlinkSync(out, join(root, 'lnk'))
    expect(() => renameEntry(root, 'lnk/f.txt', 'g.txt')).toThrow(FileOpError)
    expect(existsSync(join(out, 'f.txt'))).toBe(true)
  })
})

describe('trashEntry', () => {
  it('manda a la Papelera inyectada (no borra) y valida la ruta antes', async () => {
    await trashEntry(root, 'a.txt', trashToDir(trashDir))
    expect(existsSync(join(root, 'a.txt'))).toBe(false)
    await trashEntry(root, 'src', trashToDir(trashDir))
    expect(existsSync(join(root, 'src'))).toBe(false)
    const calls: string[] = []
    const spy = async (p: string): Promise<void> => void calls.push(p)
    for (const p of ['.git', '.git/HEAD', '', '.', '../x', 'nada']) await expect(trashEntry(root, p, spy), p).rejects.toThrow(FileOpError)
    expect(calls).toEqual([])
    expect(existsSync(join(root, '.git'))).toBe(true)
  })
  it('un enlace simbólico va como enlace', async () => {
    const out = join(root, '..', 'fuera.txt')
    writeFileSync(out, 'OUT')
    symlinkSync(out, join(root, 'ln'))
    await trashEntry(root, 'ln', trashToDir(trashDir))
    expect(existsSync(out)).toBe(true)
    expect(existsSync(join(root, 'ln'))).toBe(false)
  })
  it('traduce el fallo de la Papelera', async () => {
    await expect(
      trashEntry(root, 'a.txt', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow(/Papelera: boom/)
    expect(existsSync(join(root, 'a.txt'))).toBe(true)
  })
})
