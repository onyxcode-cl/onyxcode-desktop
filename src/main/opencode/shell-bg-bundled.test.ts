import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getAppPath: () => '/Applications/Lazunox.app/Contents/Resources/app.asar' } }))

import { SHELL_BG_SCRIPT, resolveShellBgPath, shellBgScriptCandidates } from './shell-bg-bundled'

describe('ruta del .cjs de bgshell', () => {
  it('empaquetado: sale del asar a app.asar.unpacked', () => {
    const c = shellBgScriptCandidates({
      appPath: '/Applications/Lazunox.app/Contents/Resources/app.asar',
      dirname: '/Applications/Lazunox.app/Contents/Resources/app.asar/out/main',
      cwd: '/'
    })
    // `join` usa el separador del sistema: se compara con el mismo `join` (en Windows, barras invertidas).
    expect(c[0]).toBe(join('/Applications/Lazunox.app/Contents/Resources/app.asar.unpacked', SHELL_BG_SCRIPT))
    expect(c.every((p) => !/app\.asar[/\\]/.test(p))).toBe(true)
  })
  it('desarrollo: raíz del repo aunque el app path sea out/main', () => {
    const c = shellBgScriptCandidates({ appPath: '/repo/out/main', dirname: '/repo/out/main', cwd: '/repo' })
    expect(c).toContain(join('/repo', SHELL_BG_SCRIPT))
    expect(new Set(c).size).toBe(c.length)
  })
  it('elige la primera que existe y degrada a null', () => {
    expect(resolveShellBgPath(['/a', '/b', '/c'], (p) => p !== '/a')).toBe('/b')
    expect(resolveShellBgPath(['/a'], () => false)).toBeNull()
  })
})
