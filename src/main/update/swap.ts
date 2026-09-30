import { chmodSync, copyFileSync, mkdirSync, realpathSync } from 'node:fs'
import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { basename, dirname, join, normalize, sep } from 'node:path'
import { APP_BUNDLE_NAME } from '@shared/update-install'
import { parseSemver } from '@shared/update-check'
import { stagingRoot } from './installer'
import { updateDir } from './markers'

export interface SwapArgs {
  pid: number
  target: string
  staged: string
  bak: string
  markerDir: string
  version: string
}

export interface SwapContext {
  userData: string
  /** Ruta REAL de la .app en ejecución. */
  currentApp: string
  currentVersion: string
  /** PID de esta app. */
  pid: number
}

/** `/Applications/OnyxCode.app` a partir de `.../OnyxCode.app/Contents/MacOS/OnyxCode`; null si no es un .app. */
export function bundlePathFromExe(exe: string): string | null {
  const m = /^(\/.*\/OnyxCode\.app)\/Contents\/MacOS\/[^/]+$/.exec(exe)
  return m ? m[1] : null
}

const SAFE = /^[^\0\n\r"\\]+$/

function cleanAbs(p: string): boolean {
  return typeof p === 'string' && p.startsWith('/') && normalize(p) === p && !p.endsWith('/') && SAFE.test(p)
}

/** Devuelve el motivo del rechazo, o null si los argumentos son válidos. La UI nunca aporta ninguno de ellos. */
export function validateSwapArgs(a: SwapArgs, ctx: SwapContext): string | null {
  if (!Number.isInteger(a.pid) || a.pid <= 1 || a.pid !== ctx.pid) return 'pid'
  if (!parseSemver(a.version) || !/^[0-9A-Za-z.+-]{1,64}$/.test(a.version)) return 'version'
  for (const [k, p] of Object.entries({ target: a.target, staged: a.staged, bak: a.bak, markerDir: a.markerDir })) {
    if (!cleanAbs(p)) return `ruta ${k}`
  }
  if (a.target !== ctx.currentApp || basename(a.target) !== APP_BUNDLE_NAME) return 'target distinto de la app en ejecución'
  const expectedStaged = join(stagingRoot(ctx.userData), a.version, 'extract', APP_BUNDLE_NAME)
  if (a.staged !== expectedStaged) return 'staged fuera del staging'
  if (a.markerDir !== updateDir(ctx.userData)) return 'marcadores fuera de userData/update'
  if (a.bak !== join(dirname(a.target), `.OnyxCode.app.bak-${ctx.currentVersion}`)) return 'copia de seguridad'
  if (a.staged.startsWith(a.target + sep) || a.target.startsWith(a.staged + sep)) return 'rutas anidadas'
  return null
}

export interface SwapDeps {
  /** Script sellado del paquete (Contents/Resources/updater/swap.sh). */
  scriptSource: string
  ctx: SwapContext
  spawn?: (
    cmd: string,
    args: string[],
    opts: { detached: true; stdio: 'ignore'; env: Record<string, string> }
  ) => Pick<ChildProcess, 'unref'>
  /** Variables de entorno que se pasan al script (solo las de prueba si la app no está empaquetada). */
  extraEnv?: Record<string, string>
  quit: () => void
}

let updating = false
/** `true` desde que se lanza el reemplazo: `second-instance` no debe reenfocar ni abrir ventanas. */
export function isUpdating(): boolean {
  return updating
}

/**
 * Copia el script sellado a userData/update/run/ (0700), lo lanza desacoplado con `/bin/sh <copia> args…`
 * (nunca `sh -c`) y cierra la app. Lanza si los argumentos no son válidos.
 */
export function startSwap(deps: SwapDeps, stagedApp: string, version: string): string {
  const { ctx } = deps
  const args: SwapArgs = {
    pid: ctx.pid,
    target: ctx.currentApp,
    staged: stagedApp,
    bak: join(dirname(ctx.currentApp), `.OnyxCode.app.bak-${ctx.currentVersion}`),
    markerDir: updateDir(ctx.userData),
    version
  }
  const bad = validateSwapArgs(args, ctx)
  if (bad) throw new Error(`argumentos de reemplazo no válidos (${bad})`)

  const runDir = join(updateDir(ctx.userData), 'run')
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  chmodSync(runDir, 0o700)
  const copy = join(runDir, `swap-${version}-${randomBytes(6).toString('hex')}.sh`)
  copyFileSync(deps.scriptSource, copy)
  chmodSync(copy, 0o700)

  const env: Record<string, string> = {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    HOME: process.env.HOME ?? '',
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    ...deps.extraEnv
  }
  const run = deps.spawn ?? ((c, a, o) => nodeSpawn(c, a, o))
  const child = run('/bin/sh', [copy, String(args.pid), args.target, args.staged, args.bak, args.markerDir, args.version], {
    detached: true,
    stdio: 'ignore',
    env
  })
  child.unref()
  updating = true
  deps.quit()
  return copy
}

/** Ruta real (sin symlinks) de la .app en ejecución, o null si no se ejecuta desde un .app. */
export function currentAppRealPath(exe: string): string | null {
  const p = bundlePathFromExe(exe)
  if (!p) return null
  try {
    return realpathSync(p)
  } catch {
    return null
  }
}
