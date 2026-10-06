import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { importFilesInto } from './files'

let root: string
beforeEach(() => void (root = mkdtempSync(join(tmpdir(), 'lzx-import-'))))
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('importFilesInto', () => {
  it('un archivo que ya está dentro de la carpeta (también en una subcarpeta) no se duplica', () => {
    const folder = join(root, 'f')
    mkdirSync(join(folder, 'sub'), { recursive: true })
    writeFileSync(join(folder, 'a.txt'), 'x')
    writeFileSync(join(folder, 'sub', 'b.txt'), 'y')
    const out = importFilesInto(folder, [join(folder, 'a.txt'), join(folder, 'sub', 'b.txt')])
    expect(out.map((d) => d.path)).toEqual([join(folder, 'a.txt'), join(folder, 'sub', 'b.txt')])
    expect(readdirSync(folder).sort()).toEqual(['a.txt', 'sub'])
  })
  it('un archivo de fuera se copia sin sobrescribir, y una carpeta hermana con el mismo prefijo no cuenta como «dentro»', () => {
    const folder = join(root, 'f')
    const sibling = join(root, 'f2')
    mkdirSync(folder)
    mkdirSync(sibling)
    writeFileSync(join(sibling, 'a.txt'), 'z')
    writeFileSync(join(folder, 'a.txt'), 'x')
    const out = importFilesInto(folder, [join(sibling, 'a.txt')])
    expect(out).toHaveLength(1)
    expect(out[0]!.path).not.toBe(join(folder, 'a.txt'))
    expect(readdirSync(folder)).toHaveLength(2)
  })
})
