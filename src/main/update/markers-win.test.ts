import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanupAfterBoot } from './markers'

let tmp: string
beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'lazunox-mkwin-')))
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('cleanupAfterBoot (Windows: carpetas hermanas)', () => {
  function layout() {
    const parent = join(tmp, 'Programs')
    const app = join(parent, 'Lazunox')
    const dir = join(tmp, 'ud', 'update')
    for (const d of [
      app,
      join(parent, '.Lazunox.bak-0.5.0'),
      join(parent, '.Lazunox.failed-0.5.1'),
      join(parent, '.Lazunox.staging-0.5.2'),
      join(parent, 'OtraApp'),
      join(parent, '.Lazunox.app.bak-0.3.0'), // patrón del Mac: no es de Windows
      join(dir, 'run')
    ])
      mkdirSync(d, { recursive: true })
    writeFileSync(join(dir, 'run', 'swap-0.5.1-ab.ps1'), 'x')
    return { dir, app, parent }
  }
  it('sin boot-ok de esta versión no borra nada', () => {
    const { dir, app, parent } = layout()
    cleanupAfterBoot({ dir, appPath: app, version: '0.5.1', platform: 'win32' })
    expect(existsSync(join(parent, '.Lazunox.bak-0.5.0'))).toBe(true)
  })
  it('con boot-ok borra bak, failed, staging y los scripts copiados; respeta la app y lo ajeno', () => {
    const { dir, app, parent } = layout()
    writeFileSync(join(dir, 'boot-ok-0.5.1'), '1')
    cleanupAfterBoot({ dir, appPath: app, version: '0.5.1', platform: 'win32' })
    for (const n of ['.Lazunox.bak-0.5.0', '.Lazunox.failed-0.5.1', '.Lazunox.staging-0.5.2'])
      expect(existsSync(join(parent, n)), n).toBe(false)
    expect(existsSync(app)).toBe(true)
    expect(existsSync(join(parent, 'OtraApp'))).toBe(true)
    expect(existsSync(join(parent, '.Lazunox.app.bak-0.3.0'))).toBe(true)
    expect(existsSync(join(dir, 'run', 'swap-0.5.1-ab.ps1'))).toBe(false)
  })
  it('si la carpeta de la app no se llama Lazunox no toca las hermanas', () => {
    const { dir, parent } = layout()
    writeFileSync(join(dir, 'boot-ok-0.5.1'), '1')
    cleanupAfterBoot({ dir, appPath: join(parent, 'OtraApp'), version: '0.5.1', platform: 'win32' })
    expect(existsSync(join(parent, '.Lazunox.bak-0.5.0'))).toBe(true)
  })
})
