import { describe, expect, it } from 'vitest'
import { resolveDefaultShell } from './shell'

const abs = (p: string): boolean => p.startsWith('/') || /^[A-Za-z]:\\/.test(p)
const probe = (platform: NodeJS.Platform, env: Record<string, string>, present: string[]) => ({
  platform,
  env,
  exists: (p: string) => present.includes(p),
  isAbsolute: abs
})

describe('resolveDefaultShell', () => {
  it('Windows: pwsh.exe en Program Files si existe', () => {
    const r = resolveDefaultShell(
      probe('win32', { ProgramFiles: 'C:\\Program Files', COMSPEC: 'C:\\Windows\\System32\\cmd.exe' }, [
        'C:\\Program Files\\PowerShell\\7\\pwsh.exe'
      ])
    )
    expect(r).toEqual({ command: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-NoLogo'] })
  })
  it('Windows: pwsh.exe en el Path (clave «Path», no «PATH»)', () => {
    const r = resolveDefaultShell(probe('win32', { Path: 'C:\\x;D:\\tools' }, ['D:\\tools\\pwsh.exe']))
    expect(r.command).toBe('D:\\tools\\pwsh.exe')
  })
  it('Windows: sin pwsh → PowerShell 5.1 con -NoLogo, nunca cmd', () => {
    const ps = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const r = resolveDefaultShell(
      probe('win32', { SystemRoot: 'C:\\Windows', COMSPEC: 'C:\\Windows\\System32\\cmd.exe', SHELL: 'C:\\Git\\bin\\bash.exe' }, [
        ps,
        'C:\\Git\\bin\\bash.exe'
      ])
    )
    expect(r).toEqual({ command: ps, args: ['-NoLogo'] })
  })
  it('Windows: sin nada conocido cae a powershell.exe por nombre', () => {
    expect(resolveDefaultShell(probe('win32', {}, [])).command).toBe('powershell.exe')
  })
  it('macOS: respeta $SHELL y usa -l', () => {
    expect(resolveDefaultShell(probe('darwin', { SHELL: '/bin/zsh' }, ['/bin/zsh']))).toEqual({ command: '/bin/zsh', args: ['-l'] })
  })
  it('macOS: sin $SHELL cae a zsh/bash/sh', () => {
    expect(resolveDefaultShell(probe('darwin', {}, ['/bin/bash'])).command).toBe('/bin/bash')
    expect(resolveDefaultShell(probe('darwin', {}, [])).command).toBe('/bin/sh')
  })
})
