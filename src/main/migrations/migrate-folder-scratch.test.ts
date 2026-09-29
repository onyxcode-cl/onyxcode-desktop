import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrateFolderScratch } from './migrate-folder-scratch'
import { cleanTmp, snapshot, tmpDir } from './test-helpers'

afterEach(() => cleanTmp((p) => rmSync(p, { recursive: true, force: true })))

function seedOld(folder: string): void {
  mkdirSync(join(folder, '.cowork/pylib'), { recursive: true })
  mkdirSync(join(folder, '.cowork/grabaciones/r1'), { recursive: true })
  mkdirSync(join(folder, '.cowork/descargas'), { recursive: true })
  writeFileSync(join(folder, '.cowork/pylib/x.py'), 'print(1)')
  writeFileSync(join(folder, '.cowork/grabaciones/r1/v.mov'), 'video')
  writeFileSync(join(folder, '.cowork/descargas/a.pdf'), 'pdf')
}

describe('migrateFolderScratch', () => {
  it('sin .cowork/ no hace nada (y no crea .onyxcode/)', () => {
    const f = tmpDir()
    expect(migrateFolderScratch(f)).toEqual({ status: 'none', moved: [], left: [] })
    expect(readdirSync(f)).toEqual([])
  })

  it('renombra .cowork/ -> .onyxcode/trabajo/ conservando el contenido y sin tocar memoria.md', () => {
    const f = tmpDir()
    seedOld(f)
    mkdirSync(join(f, '.onyxcode'), { recursive: true })
    writeFileSync(join(f, '.onyxcode/memoria.md'), '# memoria del proyecto')
    const r = migrateFolderScratch(f)
    expect(r.status).toBe('renamed')
    expect(existsSync(join(f, '.cowork'))).toBe(false)
    expect(readFileSync(join(f, '.onyxcode/trabajo/pylib/x.py'), 'utf8')).toBe('print(1)')
    expect(readFileSync(join(f, '.onyxcode/trabajo/grabaciones/r1/v.mov'), 'utf8')).toBe('video')
    expect(readFileSync(join(f, '.onyxcode/trabajo/descargas/a.pdf'), 'utf8')).toBe('pdf')
    expect(readFileSync(join(f, '.onyxcode/memoria.md'), 'utf8')).toBe('# memoria del proyecto')
    expect(readdirSync(join(f, '.onyxcode')).sort()).toEqual(['memoria.md', 'trabajo'])
  })

  it('crea .onyxcode/ si no existía y es idempotente', () => {
    const f = tmpDir()
    seedOld(f)
    expect(migrateFolderScratch(f).status).toBe('renamed')
    const after = snapshot(f)
    expect(migrateFolderScratch(f).status).toBe('none')
    expect(snapshot(f)).toEqual(after)
  })

  it('ambos existentes: mueve lo que no choca y deja el resto en .cowork/ sin borrar nada', () => {
    const f = tmpDir()
    seedOld(f)
    mkdirSync(join(f, '.onyxcode/trabajo/descargas'), { recursive: true })
    writeFileSync(join(f, '.onyxcode/trabajo/descargas/b.pdf'), 'nuevo')
    writeFileSync(join(f, '.onyxcode/memoria.md'), 'memoria')
    const logs: string[] = []
    const r = migrateFolderScratch(f, (m) => logs.push(m))
    expect(r.status).toBe('partial')
    expect(r.moved.sort()).toEqual(['grabaciones', 'pylib'])
    expect(r.left).toEqual(['descargas'])
    expect(logs.length).toBeGreaterThan(0)
    // Lo que choca se queda intacto en ambos lados.
    expect(readFileSync(join(f, '.cowork/descargas/a.pdf'), 'utf8')).toBe('pdf')
    expect(readFileSync(join(f, '.onyxcode/trabajo/descargas/b.pdf'), 'utf8')).toBe('nuevo')
    expect(readFileSync(join(f, '.onyxcode/trabajo/pylib/x.py'), 'utf8')).toBe('print(1)')
    expect(readFileSync(join(f, '.onyxcode/memoria.md'), 'utf8')).toBe('memoria')
  })

  it('ambos existentes sin colisiones: status merged', () => {
    const f = tmpDir()
    seedOld(f)
    mkdirSync(join(f, '.onyxcode/trabajo/otra'), { recursive: true })
    const r = migrateFolderScratch(f)
    expect(r.status).toBe('merged')
    expect(readdirSync(join(f, '.onyxcode/trabajo')).sort()).toEqual(['descargas', 'grabaciones', 'otra', 'pylib'])
  })

  it('no sigue symlinks: .cowork como enlace no se migra', () => {
    const f = tmpDir()
    const real = tmpDir()
    writeFileSync(join(real, 'secreto.txt'), 's')
    symlinkSync(real, join(f, '.cowork'))
    const r = migrateFolderScratch(f)
    expect(r.status).toBe('skipped')
    expect(lstatSync(join(f, '.cowork')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(f, '.onyxcode'))).toBe(false)
    expect(readFileSync(join(real, 'secreto.txt'), 'utf8')).toBe('s')
  })

  it('no sigue symlinks: .onyxcode como enlace no se toca', () => {
    const f = tmpDir()
    const real = tmpDir()
    seedOld(f)
    symlinkSync(real, join(f, '.onyxcode'))
    expect(migrateFolderScratch(f).status).toBe('skipped')
    expect(readdirSync(real)).toEqual([])
    expect(existsSync(join(f, '.cowork/pylib/x.py'))).toBe(true)
  })

  it('en la fusión los symlinks internos se quedan sin mover', () => {
    const f = tmpDir()
    seedOld(f)
    symlinkSync('/tmp', join(f, '.cowork/enlace'))
    mkdirSync(join(f, '.onyxcode/trabajo'), { recursive: true })
    const r = migrateFolderScratch(f)
    expect(r.status).toBe('partial')
    expect(r.left).toEqual(['enlace'])
    expect(lstatSync(join(f, '.cowork/enlace')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(f, '.onyxcode/trabajo/enlace'))).toBe(false)
  })
})
