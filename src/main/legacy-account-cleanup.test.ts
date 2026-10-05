import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { posixOnly } from '../test/platform'
import { cleanLegacyAccountSession, LEGACY_ACCOUNT_FILES } from './legacy-account-cleanup'

let root: string
let userData: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'legacy-account-'))
  userData = join(root, 'userData')
  mkdirSync(userData)
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

const rel = (paths: string[]): string[] => paths.map((p) => p.slice(userData.length + 1)).sort()

describe('cleanLegacyAccountSession', () => {
  it('la lista son exactamente los cuatro archivos de la cuenta', () => {
    expect([...LEGACY_ACCOUNT_FILES]).toEqual(['account.bin', 'account.bin.tmp', 'account.test.json', 'account.test.json.tmp'])
  })

  it('borra solo los cuatro y deja intacto todo lo demás de userData', () => {
    for (const n of LEGACY_ACCOUNT_FILES) writeFileSync(join(userData, n), 'sesion')
    const others = [
      'remote.bin',
      'settings.json',
      'migrations.json',
      'account.backup',
      'account.bin.bak',
      'xaccount.bin',
      'account.json',
      'sentinel.txt'
    ]
    for (const n of others) writeFileSync(join(userData, n), `contenido-${n}`)
    mkdirSync(join(userData, 'opencode-data'))
    writeFileSync(join(userData, 'opencode-data', 'auth.json'), '{"k":1}')

    const removed = cleanLegacyAccountSession(userData)

    expect(rel(removed)).toEqual([...LEGACY_ACCOUNT_FILES].sort())
    for (const n of LEGACY_ACCOUNT_FILES) expect(existsSync(join(userData, n))).toBe(false)
    for (const n of others) expect(readFileSync(join(userData, n), 'utf8')).toBe(`contenido-${n}`)
    expect(readFileSync(join(userData, 'opencode-data', 'auth.json'), 'utf8')).toBe('{"k":1}')
    expect(readdirSync(userData).sort()).toEqual([...others, 'opencode-data'].sort())
  })

  it('borra también si solo hay un .tmp suelto', () => {
    writeFileSync(join(userData, 'account.bin.tmp'), 'x')
    expect(rel(cleanLegacyAccountSession(userData))).toEqual(['account.bin.tmp'])
    expect(existsSync(join(userData, 'account.bin.tmp'))).toBe(false)
  })

  it('es idempotente: la segunda llamada no borra nada', () => {
    writeFileSync(join(userData, 'account.bin'), 'x')
    expect(cleanLegacyAccountSession(userData)).toHaveLength(1)
    expect(cleanLegacyAccountSession(userData)).toEqual([])
  })

  it('sin archivos de cuenta no borra nada ni avisa', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    writeFileSync(join(userData, 'remote.bin'), 'r')
    expect(cleanLegacyAccountSession(userData)).toEqual([])
    expect(warn).not.toHaveBeenCalled()
    expect(existsSync(join(userData, 'remote.bin'))).toBe(true)
  })

  it('un userData inexistente no lanza ni avisa', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(cleanLegacyAccountSession(join(root, 'no-existe'))).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })

  it('una carpeta con el mismo nombre no se toca (ni su contenido)', () => {
    mkdirSync(join(userData, 'account.bin'))
    writeFileSync(join(userData, 'account.bin', 'dentro.txt'), 'dentro')
    mkdirSync(join(userData, 'account.test.json.tmp'))
    writeFileSync(join(userData, 'account.test.json'), 'x')

    const removed = cleanLegacyAccountSession(userData)

    expect(rel(removed)).toEqual(['account.test.json'])
    expect(lstatSync(join(userData, 'account.bin')).isDirectory()).toBe(true)
    expect(readFileSync(join(userData, 'account.bin', 'dentro.txt'), 'utf8')).toBe('dentro')
    expect(lstatSync(join(userData, 'account.test.json.tmp')).isDirectory()).toBe(true)
  })

  // Symlinks sin privilegios: solo POSIX.
  it.skipIf(!posixOnly)('un enlace simbólico se borra pero su destino (fuera de userData) queda intacto', () => {
    const outside = join(root, 'fuera.txt')
    writeFileSync(outside, 'ajeno')
    symlinkSync(outside, join(userData, 'account.test.json'))
    symlinkSync(outside, join(userData, 'account.bin'))

    const removed = cleanLegacyAccountSession(userData)

    expect(rel(removed)).toEqual(['account.bin', 'account.test.json'])
    expect(() => lstatSync(join(userData, 'account.test.json'))).toThrow()
    expect(() => lstatSync(join(userData, 'account.bin'))).toThrow()
    expect(readFileSync(outside, 'utf8')).toBe('ajeno')
  })

  it.skipIf(!posixOnly)('un enlace roto también se borra, y un enlace a una carpeta no toca la carpeta', () => {
    const dir = join(root, 'carpeta-ajena')
    mkdirSync(dir)
    writeFileSync(join(dir, 'a.txt'), 'a')
    symlinkSync(dir, join(userData, 'account.bin'))
    symlinkSync(join(root, 'no-existe'), join(userData, 'account.bin.tmp'))

    const removed = cleanLegacyAccountSession(userData)

    expect(rel(removed)).toEqual(['account.bin', 'account.bin.tmp'])
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('a')
  })

  it.skipIf(!posixOnly)('si userData es un enlace a una carpeta real, borra dentro de ella y nada más', () => {
    const real = join(root, 'real')
    mkdirSync(real)
    writeFileSync(join(real, 'account.bin'), 'x')
    writeFileSync(join(real, 'remote.bin'), 'r')
    const link = join(root, 'link')
    symlinkSync(real, link)

    expect(cleanLegacyAccountSession(link)).toHaveLength(1)
    expect(existsSync(join(real, 'account.bin'))).toBe(false)
    expect(existsSync(join(real, 'remote.bin'))).toBe(true)
  })

  // chmod 0500 sobre la carpeta no impide borrar como root ni en Windows: solo POSIX y no root.
  it.skipIf(!posixOnly || (typeof process.getuid === 'function' && process.getuid() === 0))(
    'un error de permisos se registra y no lanza; no toca nada más',
    () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      writeFileSync(join(userData, 'account.bin'), 'x')
      writeFileSync(join(userData, 'remote.bin'), 'r')
      chmodSync(userData, 0o500)
      try {
        let removed: string[] = []
        expect(() => {
          removed = cleanLegacyAccountSession(userData)
        }).not.toThrow()
        expect(removed).toEqual([])
        expect(warn).toHaveBeenCalled()
      } finally {
        chmodSync(userData, 0o700)
      }
      expect(readFileSync(join(userData, 'account.bin'), 'utf8')).toBe('x')
      expect(readFileSync(join(userData, 'remote.bin'), 'utf8')).toBe('r')
    }
  )
})
