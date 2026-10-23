import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STALE_TMP_MS, cleanStaleCraft, type CleanFs } from './craft-clean'

let root: string
let bin: string
let outside: string
const NOW = Date.now()
const HOUR = 60 * 60 * 1000

const mk = (name: string, ageMs = 0): string => {
  const p = join(bin, name)
  mkdirSync(join(p, 'sub'), { recursive: true })
  writeFileSync(join(p, 'sub', 'f.txt'), 'x')
  const t = (NOW - ageMs) / 1000
  utimesSync(p, t, t)
  return p
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'craft-clean-'))
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

describe('cleanStaleCraft', () => {
  it('borra varias versiones viejas y conserva la actual', () => {
    mk('craft-0.4.0')
    mk('craft-0.4.9')
    mk('craft-0.10.2')
    const cur = mk('craft-0.5.0')
    const removed = cleanStaleCraft({ binDir: bin, currentDir: cur, now: NOW })
    expect(removed.sort()).toEqual(['craft-0.10.2', 'craft-0.4.0', 'craft-0.4.9'])
    expect(existsSync(join(bin, 'craft-0.4.0'))).toBe(false)
    expect(existsSync(cur)).toBe(true)
  })

  it('temporales: borra los de más de 24 h y deja los recientes', () => {
    const cur = mk('craft-0.5.0')
    mk('.craft-tmp-viejo', STALE_TMP_MS + HOUR)
    mk('.craft-tmp-reciente', HOUR)
    const removed = cleanStaleCraft({ binDir: bin, currentDir: cur, now: NOW })
    expect(removed).toEqual(['.craft-tmp-viejo'])
    expect(existsSync(join(bin, '.craft-tmp-reciente'))).toBe(true)
  })

  it('no toca craft-intento.json, otras carpetas ni archivos, ni nombres raros', () => {
    const cur = mk('craft-0.5.0')
    writeFileSync(join(bin, 'craft-intento.json'), '{}')
    writeFileSync(join(bin, 'craft-0.3.0'), 'soy un archivo, no una carpeta')
    mk('otra-cosa')
    mk('craft-0.4.0-beta')
    mk('craft-1.2')
    mk('craft-0.4.0.bak')
    mk('xcraft-0.4.0')
    mk('craft-vieja')
    mk('.craft-otro', STALE_TMP_MS + HOUR)
    const removed = cleanStaleCraft({ binDir: bin, currentDir: cur, now: NOW })
    expect(removed).toEqual([])
    for (const n of [
      'craft-intento.json',
      'craft-0.3.0',
      'otra-cosa',
      'craft-0.4.0-beta',
      'craft-1.2',
      'craft-0.4.0.bak',
      'xcraft-0.4.0',
      'craft-vieja',
      '.craft-otro'
    ])
      expect(existsSync(join(bin, n))).toBe(true)
  })

  it('un enlace simbólico con nombre de versión vieja no se sigue ni se borra', () => {
    const cur = mk('craft-0.5.0')
    symlinkSync(outside, join(bin, 'craft-0.3.0'))
    symlinkSync(outside, join(bin, '.craft-tmp-enlace'))
    const removed = cleanStaleCraft({ binDir: bin, currentDir: cur, now: NOW })
    expect(removed).toEqual([])
    expect(existsSync(join(outside, 'precioso.txt'))).toBe(true)
  })

  it('currentDir fuera de binDir: no borra nada', () => {
    mk('craft-0.4.0')
    const removed = cleanStaleCraft({ binDir: bin, currentDir: join(outside, 'craft-0.5.0'), now: NOW })
    expect(removed).toEqual([])
    expect(existsSync(join(bin, 'craft-0.4.0'))).toBe(true)
  })

  it('binDir que no existe: no lanza', () => {
    expect(cleanStaleCraft({ binDir: join(root, 'nada'), currentDir: join(root, 'nada', 'craft-0.5.0'), now: NOW })).toEqual([])
  })

  it('si un borrado falla solo se registra y se sigue con el resto', () => {
    const cur = mk('craft-0.5.0')
    mk('craft-0.3.0')
    mk('craft-0.4.0')
    const fs: CleanFs = {
      readdirSync: (p) => ['craft-0.3.0', 'craft-0.4.0'].concat(p ? [] : []),
      lstatSync: (p) => ({ isDirectory: () => true, isSymbolicLink: () => false, mtimeMs: NOW - p.length * 0 }),
      realpathSync: (p) => p,
      rmSync: (p) => {
        if (p.endsWith('craft-0.3.0')) throw new Error('EBUSY')
      }
    }
    const removed = cleanStaleCraft({ binDir: bin, currentDir: cur, now: NOW, fs })
    expect(removed).toEqual(['craft-0.4.0'])
    expect(console.warn).toHaveBeenCalled()
  })

  it('una ruta real que escapa de binDir (enlace en medio) no se borra', () => {
    const cur = mk('craft-0.5.0')
    const fs: CleanFs = {
      readdirSync: () => ['craft-0.3.0'],
      lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false, mtimeMs: NOW }),
      realpathSync: (p) => (p.endsWith('craft-0.3.0') ? outside : p),
      rmSync: () => {
        throw new Error('no debería borrar')
      }
    }
    expect(cleanStaleCraft({ binDir: bin, currentDir: cur, now: NOW, fs })).toEqual([])
  })
})
