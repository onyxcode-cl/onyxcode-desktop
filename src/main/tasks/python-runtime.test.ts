/**
 * Python incluido para las skills de oficina: localización del intérprete y variables que se exportan al motor.
 * Función pura (rutas candidatas) + resolución con un `exists` falso: no toca el sistema de archivos real.
 */
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => '/repo', isPackaged: false } }))

import { findBundledPython, pythonCandidates, pythonDirFor, pythonEnvFor } from './python-runtime'

describe('pythonDirFor', () => {
  it('mapea macOS por arquitectura y rechaza el resto', () => {
    expect(pythonDirFor('darwin', 'arm64')).toBe('mac-arm64')
    expect(pythonDirFor('darwin', 'x64')).toBe('mac-x64')
    expect(pythonDirFor('win32', 'x64')).toBeNull()
    expect(pythonDirFor('linux', 'x64')).toBeNull()
    expect(pythonDirFor('darwin', 'ia32')).toBeNull()
  })
})

describe('pythonCandidates', () => {
  it('app empaquetada: primero Resources/python, luego el árbol de desarrollo', () => {
    const c = pythonCandidates({ platform: 'darwin', arch: 'arm64', resourcesPath: '/App/Contents/Resources', appPath: '/repo' })
    expect(c).toEqual([
      join('/App/Contents/Resources', 'python', 'bin', 'python3'),
      join('/repo', 'resources', 'python-bin', 'mac-arm64', 'python', 'bin', 'python3')
    ])
  })

  it('desarrollo (sin resourcesPath): solo el árbol del repo', () => {
    const c = pythonCandidates({ platform: 'darwin', arch: 'x64', appPath: '/repo' })
    expect(c).toEqual([join('/repo', 'resources', 'python-bin', 'mac-x64', 'python', 'bin', 'python3')])
  })

  it('el .asar se traduce a app.asar.unpacked (un binario no se ejecuta desde dentro del .asar)', () => {
    const c = pythonCandidates({ platform: 'darwin', arch: 'arm64', appPath: '/App/Contents/Resources/app.asar' })
    expect(c[0]).toContain('app.asar.unpacked')
  })

  it('plataformas sin Python incluido: lista vacía', () => {
    expect(pythonCandidates({ platform: 'win32', arch: 'x64', appPath: '/repo' })).toEqual([])
  })
})

describe('findBundledPython', () => {
  const base = { platform: 'darwin', arch: 'arm64', resourcesPath: '/R', appPath: '/repo' }

  it('devuelve el primer candidato que existe', () => {
    const dev = join('/repo', 'resources', 'python-bin', 'mac-arm64', 'python', 'bin', 'python3')
    expect(findBundledPython({ ...base, exists: (p) => p === dev })).toBe(dev)
    const packaged = join('/R', 'python', 'bin', 'python3')
    expect(findBundledPython({ ...base, exists: () => true })).toBe(packaged)
  })

  it('sin intérprete: null (las skills caen en python3)', () => {
    expect(findBundledPython({ ...base, exists: () => false })).toBeNull()
  })
})

describe('pythonEnvFor', () => {
  it('con intérprete exporta LAZUNOX_PYTHON y desactiva bytecode y paquetes de usuario', () => {
    const env = pythonEnvFor('/R/python/bin/python3')
    expect(env.LAZUNOX_PYTHON).toBe('/R/python/bin/python3')
    expect(env.PYTHONDONTWRITEBYTECODE).toBe('1')
    expect(env.PYTHONNOUSERSITE).toBe('1')
    expect(env.PYTHONUTF8).toBe('1')
  })

  it('sin intérprete no añade ninguna variable', () => {
    expect(pythonEnvFor(null)).toEqual({})
  })
})
