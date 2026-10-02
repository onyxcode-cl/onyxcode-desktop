/** Política gestionada: ruta por plataforma y raíces de carpeta de Windows. */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false } }))

import { managedPolicyPath, parseManagedPolicy } from './policy'

describe('managedPolicyPath', () => {
  it('macOS: /Library/Application Support/<app>/managed.json', () => {
    expect(managedPolicyPath('darwin', {})).toBe('/Library/Application Support/OnyxCode/managed.json')
  })
  it('Windows: %ProgramData%\\OnyxCode\\managed.json', () => {
    expect(managedPolicyPath('win32', { ProgramData: 'D:\\PD' })).toBe('D:\\PD\\OnyxCode\\managed.json')
    expect(managedPolicyPath('win32', {})).toBe('C:\\ProgramData\\OnyxCode\\managed.json')
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
    expect(p.allowedFolderRoots).toEqual(['/Users/x'])
  })
  it('un valor inválido sigue siendo lista vacía (fail-closed)', () => {
    expect(parseManagedPolicy({ allowedFolderRoots: 'C:\\x' }, 'f', 'win32').allowedFolderRoots).toEqual([])
  })
})
