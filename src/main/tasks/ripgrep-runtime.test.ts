/**
 * ripgrep incluido: localización de `rg` y armado del PATH de los motores (1.8.17). Pura: no toca el sistema de archivos real.
 */
import { join, posix, win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => '/repo', isPackaged: false } }))

import { findBundledRipgrep, ripgrepCandidates, ripgrepPathEnv, ripgrepSupported } from './ripgrep-runtime'

describe('ripgrepSupported', () => {
  it('macOS arm64 y Windows x64; el resto no', () => {
    expect(ripgrepSupported('darwin', 'arm64')).toBe(true)
    expect(ripgrepSupported('win32', 'x64')).toBe(true)
    expect(ripgrepSupported('darwin', 'x64')).toBe(false)
    expect(ripgrepSupported('win32', 'arm64')).toBe(false)
    expect(ripgrepSupported('linux', 'x64')).toBe(false)
  })
})

describe('ripgrepCandidates', () => {
  it('macOS empaquetado: primero Resources/ripgrep/rg, luego el árbol de desarrollo', () => {
    expect(ripgrepCandidates({ platform: 'darwin', arch: 'arm64', resourcesPath: '/App/Contents/Resources', appPath: '/repo' })).toEqual([
      '/App/Contents/Resources/ripgrep/rg',
      join('/repo', 'resources', 'ripgrep-bin', 'bin', 'rg')
    ])
  })

  it('Windows empaquetado: resources\\ripgrep\\rg.exe', () => {
    const c = ripgrepCandidates({ platform: 'win32', arch: 'x64', resourcesPath: 'C:\\App\\resources', appPath: 'C:\\repo' })
    expect(c[0]).toBe(win32.join('C:\\App\\resources', 'ripgrep', 'rg.exe'))
    expect(c[1]).toMatch(/ripgrep-bin[\\/]bin[\\/]rg\.exe$/)
  })

  it('desarrollo: sale de app.asar.unpacked si el árbol está dentro del asar', () => {
    const c = ripgrepCandidates({ platform: 'darwin', arch: 'arm64', appPath: '/App/Contents/Resources/app.asar' })
    expect(c).toEqual([
      join('/App/Contents/Resources/app.asar'.replace('app.asar', 'app.asar.unpacked'), 'resources', 'ripgrep-bin', 'bin', 'rg')
    ])
  })

  it('plataformas sin rg incluido: ninguna', () => {
    expect(ripgrepCandidates({ platform: 'linux', arch: 'x64', appPath: '/repo' })).toEqual([])
  })
})

describe('findBundledRipgrep', () => {
  it('devuelve el primero que existe, o null', () => {
    const l = { platform: 'darwin', arch: 'arm64', resourcesPath: '/R', appPath: '/repo' }
    expect(findBundledRipgrep({ ...l, exists: (p) => p === '/R/ripgrep/rg' })).toBe('/R/ripgrep/rg')
    expect(findBundledRipgrep({ ...l, exists: (p) => p.includes('ripgrep-bin') })).toBe(
      join('/repo', 'resources', 'ripgrep-bin', 'bin', 'rg')
    )
    expect(findBundledRipgrep({ ...l, exists: () => false })).toBeNull()
  })
})

describe('ripgrepPathEnv', () => {
  it('sin rg incluido no cambia nada', () => {
    expect(ripgrepPathEnv(null, '/usr/bin:/bin')).toEqual({})
  })

  it('macOS: la carpeta de rg va PRIMERA, conserva el PATH de base y las carpetas habituales, sin duplicarse', () => {
    const env = ripgrepPathEnv('/App/Contents/Resources/ripgrep/rg', '/usr/bin:/bin:/App/Contents/Resources/ripgrep', 'darwin')
    const dirs = env.PATH.split(posix.delimiter)
    expect(dirs[0]).toBe('/App/Contents/Resources/ripgrep')
    expect(dirs.filter((d) => d === '/App/Contents/Resources/ripgrep')).toHaveLength(1)
    expect(dirs).toContain('/usr/bin')
    expect(dirs).toContain('/bin')
    expect(Object.keys(env)).toEqual(['PATH'])
  })

  it('PATH de base vacío (app abierta desde el Finder sin PATH): igual queda rg primero y las carpetas habituales detrás', () => {
    const dirs = ripgrepPathEnv('/R/ripgrep/rg', '', 'darwin').PATH.split(':')
    expect(dirs[0]).toBe('/R/ripgrep')
    expect(dirs).toContain('/usr/bin')
  })

  it('Windows: separador «;» y carpeta de rg.exe primera', () => {
    const env = ripgrepPathEnv('C:\\App\\resources\\ripgrep\\rg.exe', 'C:\\Windows\\System32;C:\\Windows', 'win32')
    const dirs = env.PATH.split(';')
    expect(dirs[0]).toBe('C:\\App\\resources\\ripgrep')
    expect(dirs).toContain('C:\\Windows\\System32')
  })
})
