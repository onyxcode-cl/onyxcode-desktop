import { describe, expect, it } from 'vitest'
import { computerWinHelperPresent, resolveComputerWin } from './computer-win-flag'

const ok = { platform: 'win32', build: true, tasksWin: true, helperPresent: true, policy: null }

describe('resolveComputerWin', () => {
  it('verdadero solo con win32, puerta, tasksWin y helper', () => {
    expect(resolveComputerWin(ok)).toBe(true)
  })
  it('cualquier pieza que falte lo apaga', () => {
    expect(resolveComputerWin({ ...ok, platform: 'darwin' })).toBe(false)
    expect(resolveComputerWin({ ...ok, platform: 'linux' })).toBe(false)
    expect(resolveComputerWin({ ...ok, build: false })).toBe(false)
    expect(resolveComputerWin({ ...ok, tasksWin: false })).toBe(false)
    expect(resolveComputerWin({ ...ok, helperPresent: false })).toBe(false)
    expect(resolveComputerWin({ ...ok, policy: { disableWslTasks: true } })).toBe(false)
  })
  it('solo booleanos estrictos', () => {
    expect(resolveComputerWin({ ...ok, tasksWin: 'true' })).toBe(false)
    expect(resolveComputerWin({ ...ok, tasksWin: 1 })).toBe(false)
    expect(resolveComputerWin({ ...ok, helperPresent: 'yes' })).toBe(false)
    expect(resolveComputerWin({ ...ok, tasksWin: undefined })).toBe(false)
  })
  it('por defecto la puerta real está apagada en el repositorio', () => {
    const { build: _b, ...rest } = ok
    expect(typeof resolveComputerWin(rest)).toBe('boolean')
  })
})

describe('computerWinHelperPresent', () => {
  const loc = { resourcesPath: 'C:\\app\\resources', appPath: 'C:\\app\\resources\\app.asar', cwd: 'C:\\dev' }
  it('busca el helper empaquetado y el de desarrollo', () => {
    const seen: string[] = []
    expect(computerWinHelperPresent(loc, (p) => (seen.push(p), false))).toBe(false)
    expect(seen.some((p) => p.endsWith('computer-use/bin/cu-helper.exe') || p.endsWith('computer-use\\bin\\cu-helper.exe'))).toBe(true)
    expect(seen.some((p) => /computer-use[\\/]win[\\/]bin/.test(p))).toBe(true)
  })
  it('verdadero si algún candidato existe', () => {
    expect(computerWinHelperPresent(loc, (p) => /win[\\/]bin/.test(p))).toBe(true)
  })
})
