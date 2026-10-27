/** Política gestionada: ruta por plataforma y raíces de carpeta de Windows. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isComputerUseDisabled, loadManagedPolicy, managedPolicyPath, parseManagedPolicy } from './policy'

describe('managedPolicyPath', () => {
  it('macOS: /Library/Application Support/<app>/managed.json', () => {
    expect(managedPolicyPath('darwin', {})).toBe('/Library/Application Support/Lazunox/managed.json')
  })
  it('Windows: %ProgramData%\\Lazunox\\managed.json', () => {
    expect(managedPolicyPath('win32', { ProgramData: 'D:\\PD' })).toBe('D:\\PD\\Lazunox\\managed.json')
    expect(managedPolicyPath('win32', {})).toBe('C:\\ProgramData\\Lazunox\\managed.json')
  })
})

describe('parseManagedPolicy: allowedFolderRoots', () => {
  it('Windows acepta rutas con unidad, UNC y ~\\, y descarta las relativas', () => {
    const p = parseManagedPolicy({ allowedFolderRoots: ['C:\\Proyectos', 'D:/datos/../x', '\\\\srv\\share', 'relativa\\x'] }, 'f', 'win32')
    expect(p.allowedFolderRoots).toHaveLength(3)
    expect(p.allowedFolderRoots?.slice(0, 2)).toEqual(['C:\\Proyectos', 'D:\\x'])
    expect(p.allowedFolderRoots?.[2]).toMatch(/^\\\\srv\\share/)
  })
  it('macOS no admite rutas de Windows (quedan fuera: lista vacía de raíces válidas)', () => {
    const p = parseManagedPolicy({ allowedFolderRoots: ['C:\\Proyectos', '/Users/x'] }, 'f', 'darwin')
    expect(p.allowedFolderRoots).toHaveLength(1)
    expect(p.allowedFolderRoots?.[0]).toMatch(/Users[\\/]x$/)
  })
  it('un valor inválido sigue siendo lista vacía (fail-closed)', () => {
    expect(parseManagedPolicy({ allowedFolderRoots: 'C:\\x' }, 'f', 'win32').allowedFolderRoots).toEqual([])
  })
})

describe('parseManagedPolicy: disableWslTasks (fail-closed como el resto)', () => {
  it('true se respeta; ausente queda sin definir; solo false exacto lo desactiva', () => {
    expect(parseManagedPolicy({ disableWslTasks: true }, 'f').disableWslTasks).toBe(true)
    expect(parseManagedPolicy({}, 'f').disableWslTasks).toBeUndefined()
    expect(parseManagedPolicy({ disableWslTasks: false }, 'f').disableWslTasks).toBeUndefined()
  })
  it.each(['false', 'no', 0, null, [], {}])('un valor no booleano (%j) cuenta como true', (v) => {
    expect(parseManagedPolicy({ disableWslTasks: v }, 'f').disableWslTasks).toBe(true)
  })
  it('un archivo con forma inválida activa también disableWslTasks', () => {
    for (const raw of [null, 'x', [], 5]) expect(parseManagedPolicy(raw, 'f').disableWslTasks).toBe(true)
  })
})

describe('disableComputerUse (puente de apps; fail-closed, independiente de disableFullAccess)', () => {
  it('true se respeta; ausente queda sin definir; solo false exacto lo desactiva', () => {
    expect(parseManagedPolicy({ disableComputerUse: true }, 'f').disableComputerUse).toBe(true)
    expect(parseManagedPolicy({}, 'f').disableComputerUse).toBeUndefined()
    expect(parseManagedPolicy({ disableComputerUse: false }, 'f').disableComputerUse).toBeUndefined()
  })
  it.each(['false', 'no', 0, null, [], {}])('un valor no booleano (%j) cuenta como true', (v) => {
    expect(parseManagedPolicy({ disableComputerUse: v }, 'f').disableComputerUse).toBe(true)
  })
  it('un archivo con forma inválida activa también disableComputerUse', () => {
    for (const raw of [null, 'x', [], 5]) expect(parseManagedPolicy(raw, 'f').disableComputerUse).toBe(true)
  })
  it('isComputerUseDisabled: sin política no restringe; con clave ausente o false, no; con true o inválida, sí', () => {
    expect(isComputerUseDisabled(null)).toBe(false)
    expect(isComputerUseDisabled(undefined)).toBe(false)
    expect(isComputerUseDisabled(parseManagedPolicy({}, 'f'))).toBe(false)
    expect(isComputerUseDisabled(parseManagedPolicy({ disableComputerUse: false }, 'f'))).toBe(false)
    expect(isComputerUseDisabled(parseManagedPolicy({ disableComputerUse: true }, 'f'))).toBe(true)
    expect(isComputerUseDisabled(parseManagedPolicy({ disableComputerUse: 'sí' }, 'f'))).toBe(true)
  })
  it('no afecta a disableFullAccess ni viceversa', () => {
    const solo = parseManagedPolicy({ disableComputerUse: true }, 'f')
    expect(solo.disableFullAccess).toBeUndefined()
    expect(isComputerUseDisabled(solo)).toBe(true)
    const full = parseManagedPolicy({ disableFullAccess: true }, 'f')
    expect(full.disableComputerUse).toBeUndefined()
    expect(isComputerUseDisabled(full)).toBe(false)
  })
  it('un managed.json ilegible (JSON roto) activa disableComputerUse vía loadManagedPolicy', () => {
    const dir = mkdtempSync(join(tmpdir(), 'lzx-policy-'))
    try {
      const file = join(dir, 'managed.json')
      writeFileSync(file, '{ esto no es json')
      const p = loadManagedPolicy(file)
      expect(p?.disableComputerUse).toBe(true)
      expect(isComputerUseDisabled(p)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
