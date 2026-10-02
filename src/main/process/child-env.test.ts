/**
 * `minimalEnv` / `augmentedPath` / `extraPathDirs`: lista blanca, `Path` de Windows sin distinguir
 * mayúsculas, variables que Bun/OpenCode necesita en Windows y no filtrar secretos ni variables de Electron.
 * Los casos win32 inyectan plataforma y entorno: corren igual en macOS y en Windows.
 */
import { describe, expect, it } from 'vitest'
import { augmentedPath, extraPathDirs, minimalEnv } from './child-env'

const WIN_ENV = {
  Path: 'C:\\Windows\\System32;C:\\Windows',
  SystemRoot: 'C:\\Windows',
  USERPROFILE: 'C:\\Users\\Bentec',
  APPDATA: 'C:\\Users\\Bentec\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Users\\Bentec\\AppData\\Local',
  TEMP: 'C:\\Users\\Bentec\\AppData\\Local\\Temp',
  TMP: 'C:\\Users\\Bentec\\AppData\\Local\\Temp',
  PATHEXT: '.COM;.EXE;.BAT;.CMD',
  ComSpec: 'C:\\Windows\\system32\\cmd.exe',
  ProgramData: 'C:\\ProgramData',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  ELECTRON_RUN_AS_NODE: '1',
  NODE_OPTIONS: '--inspect',
  GITHUB_TOKEN: 'ghp_secreto',
  OPENCODE_BIN: 'C:\\onyx\\opencode.exe'
}

describe('minimalEnv (win32)', () => {
  const env = minimalEnv({}, { platform: 'win32', source: WIN_ENV })

  it('conserva la variable de rutas como Path (no la descarta por mayúsculas) y la amplía', () => {
    expect(env.Path.startsWith('C:\\Windows\\System32;C:\\Windows;')).toBe(true)
    expect(env.Path).toContain('C:\\Users\\Bentec\\.opencode\\bin')
    expect(env.Path).toContain('C:\\Users\\Bentec\\AppData\\Local\\Programs')
    expect(env.Path).toContain('C:\\Program Files\\Git\\cmd')
    expect(Object.keys(env).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['Path'])
  })

  it('hereda lo que OpenCode/Bun necesita para arrancar', () => {
    for (const k of [
      'SystemRoot',
      'USERPROFILE',
      'APPDATA',
      'LOCALAPPDATA',
      'TEMP',
      'TMP',
      'PATHEXT',
      'ComSpec',
      'ProgramData',
      'OPENCODE_BIN'
    ]) {
      expect(env[k], k).toBe((WIN_ENV as Record<string, string>)[k])
    }
  })

  it('no filtra variables de Electron, NODE_OPTIONS ni tokens', () => {
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.NODE_OPTIONS).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
  })

  it('acepta claves en otra capitalización (PATH, systemroot) y no duplica', () => {
    const e = minimalEnv({}, { platform: 'win32', source: { PATH: 'C:\\a', systemroot: 'C:\\Windows', Temp: 'C:\\t' } })
    expect(Object.keys(e).filter((k) => k.toUpperCase() === 'PATH')).toEqual(['PATH'])
    expect(e.systemroot).toBe('C:\\Windows')
    expect(e.Temp).toBe('C:\\t')
    expect(Object.keys(e).filter((k) => k.toUpperCase() === 'TEMP')).toHaveLength(1)
  })

  it('extra sobrescribe sin distinguir mayúsculas y undefined borra', () => {
    const e = minimalEnv({ PATH: 'C:\\solo', TEMP: undefined, XDG_DATA_HOME: 'C:\\datos' }, { platform: 'win32', source: WIN_ENV })
    expect(e.PATH).toBe('C:\\solo')
    expect(e.Path).toBeUndefined()
    expect(e.XDG_DATA_HOME).toBe('C:\\datos')
    expect(Object.keys(e).filter((k) => k.toUpperCase() === 'TEMP')).toEqual([])
  })

  it('pone valores por defecto de USERPROFILE/TEMP si faltan', () => {
    const e = minimalEnv({}, { platform: 'win32', source: { Path: 'C:\\a', USERPROFILE: 'C:\\Users\\X' } })
    expect(e.USERPROFILE).toBe('C:\\Users\\X')
    expect(e.HOME).toBe('C:\\Users\\X')
    expect(e.TEMP).toBeTruthy()
    expect(e.TMP).toBe(e.TEMP)
  })
})

describe('minimalEnv (POSIX)', () => {
  const src = {
    PATH: '/usr/bin',
    HOME: '/Users/x',
    HTTPS_PROXY: 'http://p',
    LC_ALL: 'es_CL.UTF-8',
    ELECTRON_RENDERER_URL: 'x',
    SECRET_TOKEN: 's',
    SystemRoot: 'C:\\no'
  }
  const env = minimalEnv({}, { platform: 'darwin', source: src })
  it('lista blanca sensible a mayúsculas, sin variables de Windows', () => {
    expect(env.HTTPS_PROXY).toBe('http://p')
    expect(env.LC_ALL).toBe('es_CL.UTF-8')
    expect(env.ELECTRON_RENDERER_URL).toBeUndefined()
    expect(env.SECRET_TOKEN).toBeUndefined()
    expect(env.SystemRoot).toBeUndefined()
    expect(env.TMPDIR).toBeTruthy()
    expect(env.PATH.split(':')).toEqual(expect.arrayContaining(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin']))
  })
})

describe('augmentedPath / extraPathDirs', () => {
  it('Windows: separador ; y sin duplicar aunque difieran mayúsculas o barra final', () => {
    const dirs = ['C:\\Users\\X\\.opencode\\bin']
    const p = augmentedPath('c:\\users\\x\\.OPENCODE\\bin\\;C:\\Windows', dirs, 'win32')
    expect(p).toBe('c:\\users\\x\\.OPENCODE\\bin\\;C:\\Windows')
  })
  it('extraPathDirs win32 omite carpetas de variables ausentes', () => {
    expect(extraPathDirs('win32', { USERPROFILE: 'C:\\Users\\X' }, 'C:\\h')).toEqual(['C:\\Users\\X\\.opencode\\bin'])
  })
})
