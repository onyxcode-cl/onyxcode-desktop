import { describe, expect, it } from 'vitest'
import {
  evaluateLocationWin,
  installDirFromUninstallString,
  isLazunoxUninstallName,
  parseUninstallEntries,
  readUninstallKeyWin
} from './win-location'
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

// Contenido REAL de `reg.exe query` en un PC con Lazunox 0.5.14 instalado con el instalador NSIS (electron-builder): el nombre lleva la
// versión, no hay InstallLocation y la ruta solo está en UninstallString / DisplayIcon. Antes de este arreglo el actualizador no lo
// reconocía (`no-uninstall-key`) y en Windows solo ofrecía «Descargar».
const REAL_DIR = 'C:\\Users\\Bentec\\AppData\\Local\\Programs\\Lazunox'
const REAL_REG = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\139f0a7f-399d-5fde-985e-7ffd071dbaef',
  '    DisplayName    REG_SZ    Lazunox 0.5.14',
  `    UninstallString    REG_SZ    "${REAL_DIR}\\Uninstall Lazunox.exe" /currentuser`,
  `    QuietUninstallString    REG_SZ    "${REAL_DIR}\\Uninstall Lazunox.exe" /currentuser /S`,
  '    DisplayVersion    REG_SZ    0.5.14',
  `    DisplayIcon    REG_SZ    ${REAL_DIR}\\Lazunox.exe,0`,
  '    Publisher    REG_SZ    bentec',
  '    NoModify    REG_DWORD    0x1',
  ''
].join('\r\n')

describe('instalación real con el instalador NSIS (nombre con versión, sin InstallLocation)', () => {
  const real = { ...base, installDir: REAL_DIR, tempDir: 'C:\\Users\\Bentec\\AppData\\Local\\Temp' }

  it('el nombre con versión vale; otros nombres no', () => {
    for (const ok of ['Lazunox', 'Lazunox 0.5.14', 'Lazunox 1.0.0-beta.2']) expect(isLazunoxUninstallName(ok)).toBe(true)
    for (const no of ['Lazunox Pro', 'MiLazunox 0.5.14', 'Lazunox 0.5', 'Lazunox  0.5.14 x', 'OtraApp', ''])
      expect(isLazunoxUninstallName(no)).toBe(false)
  })

  it('la carpeta sale del desinstalador que registra el instalador', () => {
    expect(installDirFromUninstallString(`"${REAL_DIR}\\Uninstall Lazunox.exe" /currentuser`)).toBe(REAL_DIR)
    expect(installDirFromUninstallString(`${REAL_DIR}\\Uninstall Lazunox.exe /currentuser`)).toBe(REAL_DIR)
  })

  it('rechaza desinstaladores que no son el de Lazunox o rutas no absolutas', () => {
    expect(installDirFromUninstallString('"C:\\Otra\\setup.exe" /S')).toBeNull()
    expect(installDirFromUninstallString('"Uninstall Lazunox.exe"')).toBeNull()
    expect(installDirFromUninstallString('')).toBeNull()
  })

  it('el registro real se interpreta y la carpeta por usuario es VÁLIDA (antes: no-uninstall-key)', async () => {
    expect(parseUninstallEntries(REAL_REG)).toEqual([{ displayName: 'Lazunox 0.5.14', installLocation: REAL_DIR }])
    expect(await evaluateLocationWin({ ...real, run: run(REAL_REG) })).toEqual({ ok: true })
  })

  it('si la clave apunta a otra carpeta, sigue sin valer (key-mismatch)', async () => {
    const r = await evaluateLocationWin({ ...real, installDir: 'C:\\Users\\Bentec\\Descargas\\Lazunox', run: run(REAL_REG) })
    expect(r).toEqual({ ok: false, reason: 'key-mismatch' })
  })

  it('una clave con nombre «Lazunox Pro» o sin desinstalador propio no cuenta', async () => {
    const otro = REAL_REG.replace('Lazunox 0.5.14', 'Lazunox Pro')
    expect(await evaluateLocationWin({ ...real, run: run(otro) })).toEqual({ ok: false, reason: 'no-uninstall-key' })
    const sinUn = REAL_REG.replace(/Uninstall Lazunox\.exe/g, 'otro.exe')
    expect(await evaluateLocationWin({ ...real, run: run(sinUn) })).toEqual({ ok: false, reason: 'no-uninstall-key' })
  })
})
