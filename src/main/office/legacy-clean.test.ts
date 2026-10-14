import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CleanFs } from './craft/craft-clean'
import { cleanLegacyLibreOffice } from './legacy-clean'

let root: string
let bin: string
let outside: string

const mk = (name: string): string => {
  const p = join(bin, name)
  mkdirSync(join(p, 'sub'), { recursive: true })
  writeFileSync(join(p, 'sub', 'f.txt'), 'x')
  return p
}

const stat = { isDirectory: () => true, isSymbolicLink: () => false, mtimeMs: 0 }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lo-clean-'))
  bin = join(root, 'bin')
  outside = join(root, 'fuera')
  mkdirSync(bin)
  mkdirSync(outside)
  writeFileSync(join(outside, 'precioso.txt'), 'no tocar')
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('cleanLegacyLibreOffice', () => {
  it('borra libreoffice-<versión> y deja constancia', () => {
    mk('libreoffice-26.8.1')
    mk('libreoffice-7.6')
    const removed = cleanLegacyLibreOffice({ binDir: bin })
    expect(removed.sort()).toEqual(['libreoffice-26.8.1', 'libreoffice-7.6'])
    expect(existsSync(join(bin, 'libreoffice-26.8.1'))).toBe(false)
    expect(console.warn).toHaveBeenCalled()
  })

  it('no toca otras carpetas ni nombres que no cumplen el patrón', () => {
    const keep = [
      'craft-0.5.0',
      'libreoffice',
      'libreoffice-',
      'libreoffice-1',
      'libreoffice-1.2.3.4.5',
      'libreoffice-x.y',
      'libreoffice-26.8.1-old',
      'mi-libreoffice-26.8'
    ]
    for (const k of keep) mk(k)
    writeFileSync(join(bin, 'libreoffice-26.8.2'), 'archivo, no carpeta')
    expect(cleanLegacyLibreOffice({ binDir: bin })).toEqual([])
    for (const k of keep) expect(existsSync(join(bin, k))).toBe(true)
    expect(existsSync(join(bin, 'libreoffice-26.8.2'))).toBe(true)
  })

  it('no sigue enlaces simbólicos', () => {
    try {
      symlinkSync(outside, join(bin, 'libreoffice-26.8.1'), 'dir')
    } catch {
      return // sin permiso para crear enlaces (Windows sin modo desarrollador)
    }
    expect(cleanLegacyLibreOffice({ binDir: bin })).toEqual([])
    expect(existsSync(join(outside, 'precioso.txt'))).toBe(true)
  })

  it('no borra si la ruta real queda fuera de bin', () => {
    const fs: CleanFs = {
      readdirSync: () => ['libreoffice-26.8.1'],
      lstatSync: () => stat,
      realpathSync: (p) => (p === bin ? bin : outside),
      rmSync: vi.fn()
    }
    expect(cleanLegacyLibreOffice({ binDir: bin, fs })).toEqual([])
    expect(fs.rmSync).not.toHaveBeenCalled()
  })

  it('tolera fallos: un borrado que falla no impide el siguiente ni lanza', () => {
    const fs: CleanFs = {
      readdirSync: () => ['libreoffice-26.8.1', 'libreoffice-7.6'],
      lstatSync: () => stat,
      realpathSync: (p) => p,
      rmSync: (p) => {
        if (p.endsWith('26.8.1')) throw new Error('EBUSY')
      }
    }
    expect(cleanLegacyLibreOffice({ binDir: bin, fs })).toEqual(['libreoffice-7.6'])
  })

  it('tolera que bin no exista o no se pueda leer', () => {
    expect(cleanLegacyLibreOffice({ binDir: join(root, 'no-existe') })).toEqual([])
  })
})
