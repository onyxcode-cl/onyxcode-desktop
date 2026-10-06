import { describe, expect, it } from 'vitest'
import { evaluateLocationWin, parseUninstallEntries, readUninstallKeyWin } from './win-location'
import type { RunFn } from './installer'

const DIR = 'C:\\Users\\Ana\\AppData\\Local\\Programs\\Lazunox'
const REG = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{ABC}',
  '    DisplayName    REG_SZ    Lazunox',
  `    InstallLocation    REG_SZ    ${DIR}`,
  '    DisplayVersion    REG_SZ    0.5.0',
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{OLD}',
  '    DisplayName    REG_SZ    OtraApp',
  '    InstallLocation    REG_SZ    C:\\Users\\Ana\\AppData\\Local\\Programs\\OtraApp',
  ''
].join('\r\n')

const run =
  (stdout: string, code = 0): RunFn =>
  async () => ({ code, stdout, stderr: '' })
const base = {
  systemRoot: 'C:\\Windows',
  installDir: DIR,
  env: { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
  tempDir: 'C:\\Users\\Ana\\AppData\\Local\\Temp',
  probe: async () => true
}

describe('parseUninstallEntries', () => {
  it('extrae DisplayName e InstallLocation por bloque', () => {
    expect(parseUninstallEntries(REG)).toEqual([
      { displayName: 'Lazunox', installLocation: DIR },
      { displayName: 'OtraApp', installLocation: 'C:\\Users\\Ana\\AppData\\Local\\Programs\\OtraApp' }
    ])
  })
  it('quita comillas y descarta bloques incompletos', () => {
    const s =
      'HKEY_X\\a\r\n    DisplayName    REG_SZ    Lazunox\r\n    InstallLocation    REG_SZ    "C:\\x\\Lazunox"\r\nHKEY_X\\b\r\n    DisplayName    REG_SZ    Solo\r\n'
    expect(parseUninstallEntries(s)).toEqual([{ displayName: 'Lazunox', installLocation: 'C:\\x\\Lazunox' }])
  })
})

describe('readUninstallKeyWin', () => {
  it('llama a reg.exe de System32 con argumentos en array', async () => {
    const calls: unknown[][] = []
    await readUninstallKeyWin(async (c, a) => (calls.push([c, a]), { code: 0, stdout: REG, stderr: '' }), 'C:\\Windows', DIR)
    expect(calls[0]).toEqual([
      'C:\\Windows\\System32\\reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall', '/s']
    ])
  })
  it('no hay clave de Lazunox, o reg falla: null', async () => {
    expect(await readUninstallKeyWin(run('HKEY_X\\a\r\n'), 'C:\\Windows', DIR)).toBeNull()
    expect(await readUninstallKeyWin(run(REG, 1), 'C:\\Windows', DIR)).toBeNull()
  })
})

describe('evaluateLocationWin', () => {
  it('carpeta por usuario registrada y con permiso: válida', async () => {
    expect(await evaluateLocationWin({ ...base, run: run(REG) })).toEqual({ ok: true })
  })
  it('sin clave de desinstalación: no vale', async () => {
    expect(await evaluateLocationWin({ ...base, run: run('') })).toEqual({ ok: false, reason: 'no-uninstall-key' })
  })
  it('la clave apunta a otra carpeta', async () => {
    const r = await evaluateLocationWin({ ...base, installDir: 'C:\\Users\\Ana\\Descargas\\Lazunox', run: run(REG) })
    expect(r).toEqual({ ok: false, reason: 'key-mismatch' })
  })
  it('Program Files, Store, scoop y %TEMP%', async () => {
    const reasons: string[] = []
    for (const dir of [
      'C:\\Program Files\\Lazunox',
      'C:\\Program Files\\WindowsApps\\x\\Lazunox',
      'C:\\Users\\Ana\\scoop\\apps\\lazunox\\current',
      'C:\\Users\\Ana\\AppData\\Local\\Temp\\x\\Lazunox'
    ]) {
      const r = await evaluateLocationWin({ ...base, installDir: dir, run: run(REG.replace(DIR, dir)) })
      reasons.push(r.ok ? 'ok' : r.reason)
    }
    expect(reasons).toEqual(['program-files', 'store-package', 'scoop', 'temp'])
  })
  it('sin permiso de escritura en la carpeta o en su padre', async () => {
    const noParent = await evaluateLocationWin({ ...base, run: run(REG), probe: async (d) => d === DIR })
    expect(noParent).toEqual({ ok: false, reason: 'not-writable' })
    const noDir = await evaluateLocationWin({ ...base, run: run(REG), probe: async (d) => d !== DIR })
    expect(noDir).toEqual({ ok: false, reason: 'not-writable' })
  })
})
