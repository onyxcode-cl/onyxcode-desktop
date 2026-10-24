import { describe, expect, it } from 'vitest'
import {
  NEVER_ALONE_PERMISSIONS,
  PERMISSION_NO_PERSIST,
  onlyPermissionPersistEnv,
  permissionPersistEnvFor,
  rememberAlwaysOn
} from './permission-persist'

const DIR = '/Users/ana/Library/Application Support/Lazunox/permisos-siempre'

describe('permissionPersistEnvFor', () => {
  it('encendido (también por defecto, sin el campo): las tres variables', () => {
    for (const s of [{}, { rememberAlways: true }]) {
      const env = permissionPersistEnvFor(s, DIR)
      expect(env.LAZUNOX_PERMISSION_PERSIST).toBe('1')
      expect(env.LAZUNOX_PERMISSION_DIR).toBe(DIR)
      expect(env.LAZUNOX_PERMISSION_NO_PERSIST.split(',')).toEqual([...PERMISSION_NO_PERSIST])
    }
  })
  it('apagado: nada (el motor no guarda)', () => {
    expect(permissionPersistEnvFor({ rememberAlways: false }, DIR)).toEqual({})
    expect(rememberAlwaysOn({ rememberAlways: false })).toBe(false)
  })
  it('sin carpeta o con una ruta que no es absoluta: nada', () => {
    for (const d of [null, undefined, '', 'relativa/permisos', '../x']) expect(permissionPersistEnvFor({}, d)).toEqual({})
    expect(permissionPersistEnvFor({}, 'C:\\Users\\ana\\AppData\\Roaming\\Lazunox\\permisos-siempre').LAZUNOX_PERMISSION_PERSIST).toBe('1')
  })
  it('la exclusión incluye los permisos que el modo Auto nunca aprueba solo, computer_* y browser_*', () => {
    const l = permissionPersistEnvFor({}, DIR).LAZUNOX_PERMISSION_NO_PERSIST.split(',')
    for (const p of NEVER_ALONE_PERMISSIONS) expect(l).toContain(p)
    expect(l).toEqual(
      expect.arrayContaining([
        'external_directory',
        'doom_loop',
        'edit',
        'write',
        'task',
        'webfetch',
        'websearch',
        'computer_*',
        'browser_*'
      ])
    )
    expect(l).not.toContain('bash')
  })
})

describe('onlyPermissionPersistEnv', () => {
  const ok = permissionPersistEnvFor({}, DIR)
  it('deja pasar las tres variables bien formadas', () => {
    expect(onlyPermissionPersistEnv(ok)).toEqual(ok)
  })
  it('con carpeta propia del servidor la sustituye; null = no pasa nada', () => {
    expect(onlyPermissionPersistEnv(ok, '/u/tasks-sandbox/k/permisos-siempre').LAZUNOX_PERMISSION_DIR).toBe(
      '/u/tasks-sandbox/k/permisos-siempre'
    )
    expect(onlyPermissionPersistEnv(ok, null)).toEqual({})
  })
  it('descarta lo mal formado y cualquier otra clave', () => {
    expect(onlyPermissionPersistEnv({})).toEqual({})
    expect(onlyPermissionPersistEnv({ ...ok, LAZUNOX_PERMISSION_PERSIST: 'true' })).toEqual({})
    expect(onlyPermissionPersistEnv({ ...ok, LAZUNOX_PERMISSION_DIR: 'rel' })).toEqual({})
    expect(onlyPermissionPersistEnv({ ...ok, LAZUNOX_PERMISSION_NO_PERSIST: 'a b' })).toEqual({})
    expect(onlyPermissionPersistEnv({ ...ok, LAZUNOX_PERMISSION_NO_PERSIST: 'a;rm' })).toEqual({})
    expect(Object.keys(onlyPermissionPersistEnv({ ...ok, HOME: '/x', LAZUNOX_PROTECTED_PATHS: '0' })).sort()).toEqual([
      'LAZUNOX_PERMISSION_DIR',
      'LAZUNOX_PERMISSION_NO_PERSIST',
      'LAZUNOX_PERMISSION_PERSIST'
    ])
  })
  it('nunca se apaga la protección de rutas desde la app', () => {
    expect(JSON.stringify(permissionPersistEnvFor({}, DIR))).not.toContain('PROTECTED')
  })
})
