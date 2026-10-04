import { describe, expect, it } from 'vitest'
import { IPC_SCHEMAS } from './schemas'
import { isAllowedShell } from './pty-shell'

describe('pty:create (F8-B69, hallazgo 8)', () => {
  const listed = new Set(['/usr/local/bin/fish', '/opt/custom/zsh'])
  it('acepta shells conocidas en rutas de sistema o de /etc/shells', () => {
    for (const s of ['/bin/zsh', '/bin/bash', '/usr/bin/fish', '/opt/homebrew/bin/bash', '/opt/custom/zsh'])
      expect(isAllowedShell(s, 'darwin', listed), s).toBe(true)
    expect(isAllowedShell('C:\\Program Files\\PowerShell\\7\\pwsh.exe', 'win32')).toBe(true)
  })
  it('rechaza ejecutables arbitrarios, rutas con .. o fuera de las listas', () => {
    for (const s of ['/usr/bin/python3', '/bin/rm', '/tmp/x/bash', '/bin/../tmp/bash', '/bin//zsh', 'zsh', '/bin/zsh\0', '/home/u/bin/zsh'])
      expect(isAllowedShell(s, 'darwin', listed), s).toBe(false)
    expect(isAllowedShell('C:\\Users\\x\\evil.exe', 'win32')).toBe(false)
  })
  it('el esquema rechaza shell arbitraria y cwd relativo', () => {
    const v = IPC_SCHEMAS['pty:create']
    expect(() => v({ cwd: '/tmp', cols: 80, rows: 24, shell: '/usr/bin/python3' })).toThrow()
    expect(() => v({ cwd: 'relativo', cols: 80, rows: 24 })).toThrow()
    expect(() => v({ cwd: '/tmp/../etc', cols: 80, rows: 24 })).toThrow()
    expect(v({ cwd: '/tmp', cols: 80, rows: 24 })).toEqual({ cwd: '/tmp', cols: 80, rows: 24 })
    if (process.platform === 'darwin') expect(v({ cwd: '/tmp', cols: 80, rows: 24, shell: '/bin/zsh' }).shell).toBe('/bin/zsh')
  })
})
