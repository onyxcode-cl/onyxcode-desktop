import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/no/se/usa' } }))

import { ensurePermissionDir, forgetSavedPermissions, permissionDir, sandboxPermissionDir } from './permission-store'

const dirs: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'lazunox-permstore-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('carpeta de permisos guardados', () => {
  it('vive en userData/permisos-siempre y se crea con modo 0700', () => {
    const u = tmp()
    expect(permissionDir(u)).toBe(join(u, 'permisos-siempre'))
    ensurePermissionDir(permissionDir(u))
    if (process.platform !== 'win32') expect(statSync(permissionDir(u)).mode & 0o777).toBe(0o700)
  })

  it('«Olvidar» vacía la carpeta general y las de los servidores aislados, sin borrar las carpetas ni tocar lo demás', () => {
    const u = tmp()
    const general = permissionDir(u)
    mkdirSync(general, { recursive: true })
    writeFileSync(join(general, 'a.json'), '{}')
    writeFileSync(join(general, 'b.json'), '{}')
    const priv = join(u, 'tasks-sandbox', 'k1')
    const sb = sandboxPermissionDir(priv)
    mkdirSync(sb, { recursive: true })
    writeFileSync(join(sb, 'c.json'), '{}')
    writeFileSync(join(priv, 'opencode.json'), '{}') // otro archivo del servidor: no se toca
    writeFileSync(join(u, 'settings.json'), '{}')
    expect(forgetSavedPermissions(u)).toBe(3)
    expect(readdirSync(general)).toEqual([])
    expect(readdirSync(sb)).toEqual([])
    expect(existsSync(join(priv, 'opencode.json'))).toBe(true)
    expect(existsSync(join(u, 'settings.json'))).toBe(true)
    expect(forgetSavedPermissions(u)).toBe(0)
  })

  it('sin carpetas todavía: 0 y sin lanzar; un enlace se borra sin seguirlo', () => {
    const u = tmp()
    expect(forgetSavedPermissions(u)).toBe(0)
    if (process.platform === 'win32') return
    const fuera = tmp()
    writeFileSync(join(fuera, 'secreto.txt'), 'x')
    const general = permissionDir(u)
    mkdirSync(general, { recursive: true })
    symlinkSync(fuera, join(general, 'enlace'))
    expect(forgetSavedPermissions(u)).toBe(1)
    expect(lstatSync(general).isDirectory()).toBe(true)
    expect(existsSync(join(fuera, 'secreto.txt'))).toBe(true)
  })
})
