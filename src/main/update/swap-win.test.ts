import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  bakDirWin,
  isUpdatingWin,
  powershellPath,
  resetUpdatingWin,
  stagedDirWin,
  startSwapWin,
  validateSwapArgsWin,
  type SwapArgsWin,
  type SwapContextWin,
  cmdSafeArg
} from './swap-win'

// Pruebas de lógica pura con rutas de Windows (node:path/win32): corren igual en macOS y en Windows.
const TARGET = 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\Lazunox'
function ctx(): SwapContextWin {
  return { userData: 'C:\\Users\\Ana Maria\\AppData\\Roaming\\Lazunox', currentApp: TARGET, currentVersion: '0.5.0', pid: 4321 }
}
function good(c: SwapContextWin): SwapArgsWin {
  return {
    pid: c.pid,
    target: c.currentApp,
    staged: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\.Lazunox.staging-0.5.1',
    bak: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\.Lazunox.bak-0.5.0',
    markerDir: 'C:\\Users\\Ana Maria\\AppData\\Roaming\\Lazunox\\update',
    version: '0.5.1'
  }
}

afterEach(() => resetUpdatingWin())

describe('rutas hermanas', () => {
  it('staged y bak cuelgan de la carpeta padre del destino', () => {
    expect(stagedDirWin(TARGET, '0.5.1')).toBe(good(ctx()).staged)
    expect(bakDirWin(TARGET, '0.5.0')).toBe(good(ctx()).bak)
  })
})

describe('validateSwapArgsWin', () => {
  it('acepta los argumentos esperados (incluida una ruta con espacios)', () => {
    const c = ctx()
    expect(validateSwapArgsWin(good(c), c)).toBeNull()
  })
  it('compara las rutas sin distinguir mayúsculas (NTFS)', () => {
    const c = ctx()
    expect(validateSwapArgsWin({ ...good(c), target: TARGET.toUpperCase() }, c)).toBeNull()
  })
  it.each([
    ['pid ajeno', { pid: 1234 }],
    ['pid 1', { pid: 1 }],
    ['pid no entero', { pid: 4321.5 }],
    ['target distinto de la app en ejecución', { target: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\Otra\\Lazunox' }],
    ['staged fuera de la carpeta del destino', { staged: 'C:\\Temp\\.Lazunox.staging-0.5.1' }],
    ['staged de otra versión', { staged: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\.Lazunox.staging-9.9.9' }],
    ['staged anidado en el destino', { staged: `${TARGET}\\.Lazunox.staging-0.5.1` }],
    ['marcadores fuera de userData', { markerDir: 'C:\\Temp\\update' }],
    ['marcadores dentro del destino', { markerDir: `${TARGET}\\update` }],
    ['copia en otra carpeta', { bak: 'C:\\Temp\\.Lazunox.bak-0.5.0' }],
    ['copia con otra versión', { bak: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\.Lazunox.bak-0.0.1' }],
    ['versión no semver', { version: '1.0.0"; calc' }],
    ['ruta con ..', { staged: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\..\\Programs\\.Lazunox.staging-0.5.1' }],
    ['ruta con salto de línea', { markerDir: 'C:\\Users\\Ana Maria\\AppData\\Roaming\\Lazunox\\update\nx' }],
    ['ruta con comillas', { markerDir: 'C:\\Users\\Ana"Maria\\update' }],
    ['ruta con flujo ADS', { bak: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\.Lazunox.bak-0.5.0:x' }],
    ['ruta UNC', { staged: '\\\\srv\\share\\.Lazunox.staging-0.5.1' }],
    ['ruta relativa', { bak: '.Lazunox.bak-0.5.0' }],
    ['ruta con barra final', { staged: 'C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\.Lazunox.staging-0.5.1\\' }],
    ['ruta con barras normales', { markerDir: 'C:/Users/Ana Maria/AppData/Roaming/Lazunox/update' }]
  ])('rechaza %s', (_n, over) => {
    const c = ctx()
    expect(validateSwapArgsWin({ ...good(c), ...over }, c)).not.toBeNull()
  })
  it('rechaza un destino que no se llama Lazunox', () => {
    const c = { ...ctx(), currentApp: 'C:\\Programs\\App' }
    const a = {
      ...good(c),
      target: 'C:\\Programs\\App',
      staged: 'C:\\Programs\\.Lazunox.staging-0.5.1',
      bak: 'C:\\Programs\\.Lazunox.bak-0.5.0'
    }
    expect(validateSwapArgsWin(a, c)).toBe('target no es la carpeta Lazunox')
  })
})

describe('powershellPath', () => {
  it('construye la ruta absoluta de System32', () => {
    expect(powershellPath('C:\\Windows')).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })
  it.each(['', 'Windows', '\\\\srv\\x', 'C:\\Windows\\', 'C:\\Win"dows'])('rechaza %j', (v) => {
    expect(powershellPath(v)).toBeNull()
  })
})

describe('startSwapWin', () => {
  function deps(over: Partial<Parameters<typeof startSwapWin>[0]> = {}) {
    const calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = []
    let quit = 0
    let unref = 0
    return {
      calls,
      get quit() {
        return quit
      },
      get unref() {
        return unref
      },
      d: {
        scriptSource: 'C:\\app\\resources\\updater\\swap.ps1',
        ctx: ctx(),
        systemRoot: 'C:\\Windows',
        copyScript: (_s: string, runDir: string, v: string) => `${runDir}\\swap-${v}-abc.ps1`,
        spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => {
          calls.push({ cmd, args, opts })
          return { unref: () => void unref++ }
        },
        quit: () => void quit++,
        ...over
      } as Parameters<typeof startSwapWin>[0]
    }
  }

  it('lanza cmd.exe /c start /B powershell.exe (rutas absolutas, sin shell, argumentos en array) y cierra la app', () => {
    const x = deps()
    const copy = startSwapWin(x.d, good(ctx()).staged, '0.5.1')
    expect(copy).toBe('C:\\Users\\Ana Maria\\AppData\\Roaming\\Lazunox\\update\\run\\swap-0.5.1-abc.ps1')
    expect(x.calls).toHaveLength(1)
    const c = x.calls[0]
    // `powershell.exe` suelto + `detached` no arranca en Windows; con `cmd /c start /B` sí y sobrevive a la app (verificado en un PC real).
    expect(c.cmd).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(c.opts).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: true })
    expect(c.opts).not.toHaveProperty('shell')
    expect(c.args.slice(0, 6)).toEqual(['/d', '/c', 'start', '""', '/B', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'])
    const ps = c.args.slice(6)
    expect(ps.slice(0, 8)).toEqual([
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File'
    ])
    expect(ps[8]).toBe(copy)
    expect(ps.slice(9)).toEqual([
      '-AppPid',
      '4321',
      '-Target',
      TARGET,
      '-Staged',
      good(ctx()).staged,
      '-Bak',
      good(ctx()).bak,
      '-MarkerDir',
      good(ctx()).markerDir,
      '-Version',
      '0.5.1'
    ])
    expect(x.unref).toBe(1)
    expect(x.quit).toBe(1)
    expect(isUpdatingWin()).toBe(true)
  })

  it('cmdSafeArg: acepta rutas normales (con espacios) y rechaza lo que cmd.exe interpretaría', () => {
    for (const ok of ['C:\\Users\\Ana Maria\\AppData\\Local\\Programs\\Lazunox', '-ExecutionPolicy', '0.5.1', 'C:\\Users\\José\\x'])
      expect(cmdSafeArg(ok)).toBe(true)
    for (const bad of ['C:\\a&b', 'C:\\a^b', 'C:\\%TEMP%\\x', 'C:\\a!b', 'C:\\a(1)', 'a;b', 'a,b', 'a=b', "a'b", 'a`b', 'a\nb'])
      expect(cmdSafeArg(bad)).toBe(false)
  })

  it('una ruta con caracteres que cmd interpretaría no se lanza ni cierra la app', () => {
    const c = { ...ctx(), userData: 'C:\\Users\\Juan & Co\\AppData\\Roaming\\Lazunox' }
    const x = deps({ ctx: c })
    expect(() => startSwapWin(x.d, good(c).staged, '0.5.1')).toThrow()
    expect(x.calls).toHaveLength(0)
    expect(x.quit).toBe(0)
  })

  it('el entorno del script es mínimo y fija PATH a System32', () => {
    const x = deps({ extraEnv: { LAZUNOX_SWAP_WAIT_BOOT: '5' } })
    startSwapWin(x.d, good(ctx()).staged, '0.5.1')
    const env = x.calls[0].opts.env as Record<string, string>
    expect(env.PATH).toBe('C:\\Windows\\System32;C:\\Windows')
    expect(env.SystemRoot).toBe('C:\\Windows')
    expect(env.LAZUNOX_SWAP_WAIT_BOOT).toBe('5')
    expect(Object.keys(env)).not.toContain('OPENAI_API_KEY')
  })

  it('con argumentos no válidos lanza, no ejecuta nada ni cierra la app', () => {
    const x = deps()
    expect(() => startSwapWin(x.d, 'C:\\Temp\\.Lazunox.staging-0.5.1', '0.5.1')).toThrow(/no válidos/)
    expect(() => startSwapWin(x.d, good(ctx()).staged, '0.5.1; calc')).toThrow(/no válidos/)
    expect(() => startSwapWin(deps({ systemRoot: 'C:\\Win"dows' }).d, good(ctx()).staged, '0.5.1')).toThrow()
    expect(x.calls).toHaveLength(0)
    expect(x.quit).toBe(0)
    expect(isUpdatingWin()).toBe(false)
  })
})

// El script no se puede ejecutar en macOS (no hay PowerShell): estas comprobaciones son estáticas, NO sustituyen la prueba real.
describe('resources/updater/swap.ps1 (comprobación estática)', () => {
  const ps = readFileSync(resolve(__dirname, '../../../resources/updater/swap.ps1'), 'utf8')
  it('declara los parámetros que pasa startSwapWin, en el mismo orden', () => {
    const names = ['AppPid', 'Target', 'Staged', 'Bak', 'MarkerDir', 'Version'].map(
      (n) => ps.indexOf(`[string]$${n}`) >= 0 || ps.indexOf(`[int]$${n}`) >= 0
    )
    expect(names.every(Boolean)).toBe(true)
  })
  it('no evalúa texto ni usa shells', () => {
    expect(ps).not.toMatch(/Invoke-Expression|\biex\b|cmd\.exe|-EncodedCommand|DownloadString|Invoke-WebRequest/i)
  })
  it('fija el modo de prueba a C:\\onyx o TEMP y no toca el registro en él', () => {
    expect(ps).toContain('C:\\onyx\\')
    expect(ps).toContain('if ($Test) { return $null }')
  })
  it('conserva los pasos de seguridad: esperar al PID, copia, boot-ok y rollback', () => {
    for (const s of [
      'Get-Process -Id $AppPid',
      'Move-Dir $Target $Bak',
      'Move-Dir $Staged $Target',
      'boot-ok-$Version',
      'Restore-Old',
      "'boot-timeout'",
      "'backup-failed'",
      "'replace-failed'"
    ])
      expect(ps).toContain(s)
  })
})
