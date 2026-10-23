import { chmodSync, copyFileSync, mkdirSync, realpathSync } from 'node:fs'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { win32 } from 'node:path'
import { parseSemver } from '@shared/update-check'

/**
 * Reemplazo de la carpeta de la app en Windows (equivale a swap.ts del Mac). Usa `node:path/win32` explícito para que la
 * validación se pruebe igual en macOS. La carpeta nueva (`staged`) y la copia (`bak`) son HERMANAS del destino.
 */
export const WIN_APP_DIRNAME = 'Lazunox'

export interface SwapArgsWin {
  pid: number
  target: string
  staged: string
  bak: string
  markerDir: string
  version: string
}

export interface SwapContextWin {
  userData: string
  /** Carpeta REAL de la app en ejecución (dirname del ejecutable tras realpath). */
  currentApp: string
  currentVersion: string
  pid: number
}

/** `<padre>\.Lazunox.staging-<ver>` */
export function stagedDirWin(target: string, version: string): string {
  return win32.join(win32.dirname(target), `.Lazunox.staging-${version}`)
}
/** `<padre>\.Lazunox.bak-<ver>` */
export function bakDirWin(target: string, currentVersion: string): string {
  return win32.join(win32.dirname(target), `.Lazunox.bak-${currentVersion}`)
}

const SAFE = /^[^\x00-\x1f"/<>|?*]+$/

/** ¿Un argumento puede pasar por `cmd.exe` sin que éste le dé un significado especial? (sin `& ^ % ! ( ) ; , = ' ` ni saltos). */
export function cmdSafeArg(x: string): boolean {
  return typeof x === 'string' && !/[&^%!();,='`\x00-\x1f]/.test(x)
}

function cleanAbsWin(p: string): boolean {
  if (typeof p !== 'string' || !/^[A-Za-z]:\\[^\\]/.test(p) || !SAFE.test(p)) return false
  if (p.slice(2).includes(':')) return false // flujos ADS
  if (win32.normalize(p) !== p || p.endsWith('\\')) return false
  return !p.split('\\').some((s) => s === '.' || s === '..' || s === '')
}

const sameWin = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Devuelve el motivo del rechazo, o null si los argumentos son válidos. La UI nunca aporta ninguno de ellos. */
export function validateSwapArgsWin(a: SwapArgsWin, ctx: SwapContextWin): string | null {
  if (!Number.isInteger(a.pid) || a.pid <= 1 || a.pid !== ctx.pid) return 'pid'
  if (!parseSemver(a.version) || !/^[0-9A-Za-z.+-]{1,64}$/.test(a.version)) return 'version'
  if (!parseSemver(ctx.currentVersion) || !/^[0-9A-Za-z.+-]{1,64}$/.test(ctx.currentVersion)) return 'version actual'
  for (const [k, p] of Object.entries({ target: a.target, staged: a.staged, bak: a.bak, markerDir: a.markerDir })) {
    if (!cleanAbsWin(p)) return `ruta ${k}`
  }
  if (!cleanAbsWin(ctx.currentApp) || !sameWin(a.target, ctx.currentApp)) return 'target distinto de la app en ejecución'
  if (win32.basename(a.target).toLowerCase() !== WIN_APP_DIRNAME.toLowerCase()) return 'target no es la carpeta Lazunox'
  if (!sameWin(a.staged, stagedDirWin(a.target, a.version))) return 'staged no es hermano del destino'
  if (!sameWin(a.bak, bakDirWin(a.target, ctx.currentVersion))) return 'copia de seguridad'
  if (!sameWin(a.markerDir, win32.join(ctx.userData, 'update'))) return 'marcadores fuera de userData/update'
  const t = a.target.toLowerCase() + '\\'
  if (a.markerDir.toLowerCase().startsWith(t) || a.staged.toLowerCase().startsWith(t)) return 'rutas anidadas'
  return null
}

export interface SwapDepsWin {
  /** Script sellado del paquete (resources\updater\swap.ps1). */
  scriptSource: string
  ctx: SwapContextWin
  /** `%SystemRoot%` (p. ej. C:\Windows); se valida y de ahí sale la ruta ABSOLUTA de powershell.exe. */
  systemRoot: string
  spawn?: (
    cmd: string,
    args: string[],
    opts: { detached: true; stdio: 'ignore'; windowsHide: true; cwd: string; env: Record<string, string> }
  ) => Pick<ChildProcess, 'unref'>
  /** Variables de entorno que se pasan al script (solo las de prueba en un build de prueba). */
  extraEnv?: Record<string, string>
  quit: () => void
  /** Copia el script sellado a `runDir` y devuelve la ruta de la copia (inyectable en pruebas). */
  copyScript?: (source: string, runDir: string, version: string) => string
}

let updating = false
/** `true` desde que se lanza el reemplazo: `second-instance` no debe reenfocar ni abrir ventanas. */
export function isUpdatingWin(): boolean {
  return updating
}
/** Solo para pruebas. */
export function resetUpdatingWin(): void {
  updating = false
}

function defaultCopyScript(source: string, runDir: string, version: string): string {
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  try {
    chmodSync(runDir, 0o700)
  } catch {
    /* en Windows chmod solo cambia el atributo de solo lectura */
  }
  const copy = win32.join(runDir, `swap-${version}-${randomBytes(6).toString('hex')}.ps1`)
  copyFileSync(source, copy)
  return copy
}

export function powershellPath(systemRoot: string): string | null {
  if (!/^[A-Za-z]:\\[^\\]/.test(systemRoot) || !SAFE.test(systemRoot) || systemRoot.endsWith('\\')) return null
  return win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

export function psArgs(script: string, a: SwapArgsWin): string[] {
  return [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-WindowStyle',
    'Hidden',
    '-File',
    script,
    '-AppPid',
    String(a.pid),
    '-Target',
    a.target,
    '-Staged',
    a.staged,
    '-Bak',
    a.bak,
    '-MarkerDir',
    a.markerDir,
    '-Version',
    a.version
  ]
}

/**
 * Copia el script sellado a userData\update\run\, lo lanza desacoplado con powershell.exe (ruta absoluta, sin shell, argumentos
 * en array) y cierra la app. Lanza si los argumentos no son válidos. NO verifica nada del staging: eso ya lo hizo
 * `UpdateInstaller.beginInstall` (firma Ed25519 del manifiesto, SHA-256 del ZIP y `verifyApp`).
 */
export function startSwapWin(deps: SwapDepsWin, stagedApp: string, version: string): string {
  const { ctx } = deps
  const args: SwapArgsWin = {
    pid: ctx.pid,
    target: ctx.currentApp,
    staged: stagedApp,
    bak: bakDirWin(ctx.currentApp, ctx.currentVersion),
    markerDir: win32.join(ctx.userData, 'update'),
    version
  }
  const bad = validateSwapArgsWin(args, ctx)
  if (bad) throw new Error(`argumentos de reemplazo no válidos (${bad})`)
  const ps = powershellPath(deps.systemRoot)
  if (!ps) throw new Error('SystemRoot no válido')

  const runDir = win32.join(ctx.userData, 'update', 'run')
  const copy = (deps.copyScript ?? defaultCopyScript)(deps.scriptSource, runDir, version)

  const sr = deps.systemRoot
  const env: Record<string, string> = {
    SystemRoot: sr,
    windir: sr,
    PATH: `${sr}\\System32;${sr}`,
    TEMP: process.env.TEMP ?? '',
    TMP: process.env.TMP ?? process.env.TEMP ?? '',
    USERPROFILE: process.env.USERPROFILE ?? '',
    LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
    APPDATA: process.env.APPDATA ?? '',
    ...deps.extraEnv
  }
  // Lanzamiento: `powershell.exe` suelto con `detached` NO arranca el script en Windows (verificado en un PC real y con el mismo Electron:
  // PowerShell sin consola termina sin hacer nada) y sin `detached` muere con la app. Lo que sí arranca y sobrevive a que la app termine es
  // `cmd.exe /c start "" /B powershell …`. Como cmd interpreta `& ^ % ! ( ) ; , =`, ningún argumento puede llevarlos (si no, no se lanza).
  const psArguments = psArgs(copy, args)
  const bad2 = [ps, ...psArguments].find((x) => !cmdSafeArg(x))
  if (bad2 !== undefined) throw new Error('argumentos de reemplazo no aptos para cmd.exe')
  const cmd = win32.join(sr, 'System32', 'cmd.exe')
  const run = deps.spawn ?? ((c, a, o) => nodeSpawn(c, a, o))
  // `cwd` FUERA de la carpeta de la app: si el proceso del reemplazo heredara como carpeta de trabajo la de instalación (así abre Windows
  // la app desde el acceso directo del menú Inicio o del escritorio), Windows no deja renombrar esa carpeta («el archivo está siendo
  // utilizado por otro proceso») y la actualización fallaba siempre tras 20 s de reintentos.
  const child = run(cmd, ['/d', '/c', 'start', '""', '/B', ps, ...psArguments], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: sr,
    env
  })
  child.unref()
  updating = true
  deps.quit()
  return copy
}

/** Carpeta real (sin symlinks) de la app en ejecución (`dirname(exe)`), o null si no se llama «Lazunox». */
export function currentInstallDirWin(exe: string): string | null {
  if (!/^[A-Za-z]:\\/.test(exe)) return null
  const dir = win32.dirname(exe)
  try {
    const real = realpathSync(dir)
    return win32.basename(real).toLowerCase() === WIN_APP_DIRNAME.toLowerCase() ? real : null
  } catch {
    return null
  }
}
