// Utilidades de procesos multiplataforma para los E2E (macOS/Linux: pgrep/pkill; Windows: taskkill + CIM).
// Todo con timeout corto: ningún comando de aquí puede quedarse colgado.
import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'

export const IS_WIN = process.platform === 'win32'

/** Nombre del OpenCode falso dentro de su carpeta: en Windows el `.mjs` (la app lo lanza con `node`; solo pruebas). */
export const FAKE_BIN_NAME = IS_WIN ? 'server.mjs' : 'opencode'

/** Cómo nombra la interfaz el equipo del usuario («Mac» / «PC»; textos `*.win`). */
export const DEVICE = IS_WIN ? 'PC' : 'Mac'

/** Pasos del asistente de primer uso: sin «Permisos de macOS» en Windows. */
export const STEPS_TOTAL = IS_WIN ? 4 : 5

/** Separador de PATH. */
export const PATH_SEP = IS_WIN ? ';' : ':'

const PS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command']

function ps(script: string, env: Record<string, string> = {}): string {
  return execFileSync('powershell.exe', [...PS, script], {
    encoding: 'utf8',
    timeout: 20_000,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, ...env }
  })
}

/** PIDs descendientes de `pid` (en Windows, una sola consulta CIM). */
export function descendants(pid: number): number[] {
  if (IS_WIN) {
    try {
      const out = ps(
        `$a=Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId;$r=@();$q=@(${pid});while($q.Count){$n=@();foreach($x in $q){foreach($c in ($a|?{$_.ParentProcessId -eq $x})){$r+=$c.ProcessId;$n+=$c.ProcessId}};$q=$n};$r -join ','`
      )
      return out.trim().split(',').filter(Boolean).map(Number)
    } catch {
      return []
    }
  }
  try {
    const out = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5_000 })
    return out.split('\n').filter(Boolean).map(Number).flatMap((k) => [k, ...descendants(k)])
  } catch {
    return []
  }
}

export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Mata `pid` y todo su árbol (Windows: `taskkill /T /F`; POSIX: SIGKILL a cada descendiente). */
export function killTree(pid: number): void {
  if (IS_WIN) {
    try {
      execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 15_000, windowsHide: true })
    } catch {
      /* ya muerto */
    }
    return
  }
  for (const p of [pid, ...descendants(pid)]) {
    try {
      process.kill(p, 'SIGKILL')
    } catch {
      /* ya muerto */
    }
  }
}

/** Mata todo proceso cuya línea de comandos mencione `needle` (no se mata a sí mismo). */
export function killByCommandLine(needle: string): void {
  if (!needle) return
  if (IS_WIN) {
    try {
      // El patrón va por entorno: así la propia línea de comandos de powershell no lo contiene.
      ps(
        `$n=$env:ONYX_KILL_NEEDLE;Get-CimInstance Win32_Process|?{$_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.IndexOf($n,[StringComparison]::OrdinalIgnoreCase) -ge 0}|%{taskkill.exe /PID $_.ProcessId /T /F *>$null}`,
        { ONYX_KILL_NEEDLE: needle }
      )
    } catch {
      /* sin coincidencias o ya muertos */
    }
    return
  }
  try {
    execFileSync('pkill', ['-KILL', '-f', needle], { timeout: 10_000 })
  } catch {
    /* pkill sale 1 si no hay coincidencias */
  }
}

/** Líneas `pid command` de los hijos directos de `pid` (diagnóstico). */
export function childrenOf(pid: number): string {
  try {
    if (IS_WIN) return ps(`Get-CimInstance Win32_Process -Filter 'ParentProcessId=${pid}'|%{ $_.ProcessId.ToString() + ' ' + $_.CommandLine }`)
    const kids = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8', timeout: 5_000 }).trim().split('\n').join(',')
    return execFileSync('ps', ['-o', 'pid=,command=', '-p', kids], { encoding: 'utf8', timeout: 5_000 })
  } catch {
    return ''
  }
}

/**
 * Entorno aislado para specs que no deben encontrar ningún OpenCode real: HOME propio y un PATH mínimo con
 * `node` (el del runner, que el falso necesita) y lo imprescindible del sistema.
 */
export function isolatedHomeEnv(home: string): Record<string, string> {
  if (IS_WIN) {
    const sys = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32`
    // No se toca USERPROFILE: Electron obtiene `appData` de él y falla si no existe `AppData\\Roaming`. Sin OpenCode en PATH
    // ni en `%USERPROFILE%\\.opencode\\bin` basta (HOME solo se usa en POSIX).
    return { HOME: home, PATH: [dirname(process.execPath), sys].join(';') }
  }
  return { HOME: home, PATH: `${dirname(process.execPath)}:/usr/bin:/bin` }
}
