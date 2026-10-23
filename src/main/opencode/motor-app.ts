/**
 * «Lazunox Motor.app»: el motor OpenCode como ejecutable de una mini-app con id propio (`<appId>.motor`), solo macOS.
 *
 * Por qué se COPIA fuera de `Lazunox.app`: medido en la app real (registro de TCC), una mini-app anidada en `Contents/Resources` se evalúa
 * a nombre de la app contenedora (`subject=cl.bentec.lazunox`) y hereda su decisión guardada; suelta, fuera del .app, TCC la evalúa como
 * `cl.bentec.lazunox.motor`: el aviso la nombra, aparece en Ajustes › Privacidad › Archivos y carpetas y se puede restablecer por id.
 *
 * La copia maestra viaja firmada dentro de `Resources/opencode/Lazunox Motor.app` (la sella la firma de la app). Al arrancar se copia con
 * `ditto` (conserva la firma) a `~/Library/Application Support/Lazunox Motor/` — carpeta HERMANA de userData, porque el sandbox de Tareas
 * deniega leer userData — y se vuelve a copiar cuando cambia la huella de la maestra (cada versión del motor o de la app). TCC guarda
 * «id + certificado», no la ruta: la concesión sobrevive a las actualizaciones. Docs: docs/DISENO-LAZUNOX-MOTOR.md.
 */
import { MOTOR_APP_NAME } from '@shared/brand'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, accessSync, constants } from 'node:fs'
import { join } from 'node:path'

/** Carpeta (dentro de Application Support) donde vive la copia externa. */
export const MOTOR_INSTALL_DIRNAME = 'Lazunox Motor'
const FINGERPRINT_FILE = 'fuente.sha256'

export interface MotorPaths {
  /** `<Resources>/opencode/Lazunox Motor.app` (copia maestra, dentro de la app). */
  source: string
  /** `~/Library/Application Support/Lazunox Motor` */
  installDir: string
  /** `<installDir>/Lazunox Motor.app` */
  app: string
  /** `<app>/Contents/MacOS/opencode` */
  exe: string
}

export function motorPaths(resourcesPath: string, appDataPath: string): MotorPaths {
  const installDir = join(appDataPath, MOTOR_INSTALL_DIRNAME)
  const app = join(installDir, MOTOR_APP_NAME)
  return {
    source: join(resourcesPath, 'opencode', MOTOR_APP_NAME),
    installDir,
    app,
    exe: join(app, 'Contents', 'MacOS', 'opencode')
  }
}

const exeOf = (appDir: string): string => join(appDir, 'Contents', 'MacOS', 'opencode')

/** Ejecuta una herramienta del sistema y devuelve stdout+stderr (`codesign -d` escribe en stderr); lanza si sale con error o vence el plazo. */
export type MotorRun = (cmd: string, args: string[]) => string

const defaultRun: MotorRun = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 20_000 })
  if (r.error) throw r.error
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} salió con ${r.status}: ${(r.stderr ?? '').trim().slice(0, 200)}`)
  return `${r.stdout ?? ''}${r.stderr ?? ''}`
}

const sha = (...parts: (Buffer | string)[]): string => {
  const h = createHash('sha256')
  for (const x of parts) h.update(x)
  return h.digest('hex')
}

const fpCache = new Map<string, string>()

/**
 * Huella de la copia maestra. Con la app firmada es el CDHash (el CodeDirectory del ejecutable de la mini-app, que cubre el ejecutable y el
 * Info.plist: cambia con cualquier cambio de motor, de Info.plist o de firma/certificado). NO sirve `_CodeSignature/CodeResources`: en un
 * bundle con solo el ejecutable y el Info.plist no lista nada (`files=0`) y la huella sería solo el tamaño. Sin firma (pruebas) se usa el
 * hash del contenido. Se memoriza por proceso y por (ruta, ctime, tamaño) de la maestra.
 */
export function sourceFingerprint(source: string, run?: MotorRun): string | null {
  try {
    const st = statSync(exeOf(source))
    const key = `${source}:${st.ctimeMs}:${st.size}`
    if (!run) {
      const hit = fpCache.get(key)
      if (hit) return hit
    }
    let fp: string
    try {
      const cd = /^CDHash=([0-9a-f]{40,64})$/m.exec((run ?? defaultRun)('/usr/bin/codesign', ['-dvvv', source]))?.[1]
      if (!cd) throw new Error('sin CDHash')
      fp = `cd:${cd}`
    } catch {
      fp = `fs:${sha(readFileSync(exeOf(source)), ':', readFileSync(join(source, 'Contents', 'Info.plist')))}`
    }
    if (!run) fpCache.set(key, fp)
    return fp
  } catch {
    return null
  }
}

/** Requisito designado de la maestra (`identifier "<id>" and certificate leaf = H"<pin>"`), o `null` si no está firmada. */
function designatedRequirement(source: string, run: MotorRun): string | null {
  try {
    return /^designated => (.+)$/m.exec(run('/usr/bin/codesign', ['-d', '-r-', source]))?.[1]?.trim() ?? null
  } catch {
    return null
  }
}

/** La copia debe validar su firma Y cumplir el mismo requisito que la maestra (misma identidad y certificado, no cualquier firma válida). */
function verifyCopy(source: string, app: string, run: MotorRun): void {
  const req = designatedRequirement(source, run)
  run('/usr/bin/codesign', ['--verify', '--strict', ...(req ? [`-R=${req}`] : []), app])
}

function isExecutable(p: string): boolean {
  try {
    accessSync(p, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** ¿La copia externa existe, es ejecutable y corresponde a la maestra actual? */
export function installedMotorCurrent(p: MotorPaths, run?: MotorRun): boolean {
  const want = sourceFingerprint(p.source, run)
  if (!want) return false
  try {
    if (!isExecutable(p.exe)) return false
    if (readFileSync(join(p.installDir, FINGERPRINT_FILE), 'utf8').trim() !== want) return false
    return statSync(p.exe).size === statSync(exeOf(p.source)).size
  } catch {
    return false
  }
}

export type MotorInstallResult = 'current' | 'installed' | 'no-source' | 'failed'

export interface MotorInstallDeps {
  run?: MotorRun
  /** Para pruebas: identificador del proceso en los nombres temporales. */
  pid?: number
}

/**
 * Deja `Lazunox Motor.app` en `installDir` al día. Nunca lanza: devuelve `failed` y el llamador usa la copia anidada (que funciona, pero
 * a nombre de Lazunox). La sustitución es por `rename`: un motor que ya esté en marcha con la copia vieja sigue vivo hasta que salga.
 * Solo corre una instancia de Lazunox a la vez (bloqueo de instancia única), así que los temporales de intentos anteriores que murieron a
 * medias se pueden borrar sin riesgo.
 */
export function installMotorApp(p: MotorPaths, deps: MotorInstallDeps = {}): MotorInstallResult {
  const run = deps.run ?? defaultRun
  const fp = sourceFingerprint(p.source, deps.run)
  if (!fp) return 'no-source'
  if (installedMotorCurrent(p, deps.run)) {
    // «Al día» mira la huella y el tamaño: además se comprueba la firma completa y que cumpla el requisito de la maestra (≈0,1 s). Si la
    // copia fue alterada, reemplazada por otra firma o quedó a medias, no se da por buena y se reinstala desde la maestra firmada.
    try {
      verifyCopy(p.source, p.app, run)
      return 'current'
    } catch {
      console.error('[motor] la copia de «Lazunox Motor.app» no valida su firma: se reinstala')
    }
  }
  const id = deps.pid ?? process.pid
  const tmpApp = join(p.installDir, `.nuevo-${id}`, MOTOR_APP_NAME)
  const oldApp = join(p.installDir, `.viejo-${id}`)
  try {
    mkdirSync(p.installDir, { recursive: true, mode: 0o700 })
    // Restos de intentos anteriores que murieron a medias (cada uno pesa ~140 MB).
    for (const name of readdirSync(p.installDir)) {
      if (name.startsWith('.nuevo-') || name.startsWith('.viejo-')) rmSync(join(p.installDir, name), { recursive: true, force: true })
    }
    mkdirSync(join(p.installDir, `.nuevo-${id}`), { recursive: true })
    run('/usr/bin/ditto', [p.source, tmpApp])
    // La copia debe ser válida y de la misma identidad que la maestra antes de ponerla en su sitio.
    verifyCopy(p.source, tmpApp, run)
    if (existsSync(p.app)) renameSync(p.app, oldApp)
    renameSync(tmpApp, p.app)
    writeFileSync(join(p.installDir, FINGERPRINT_FILE), `${fp}\n`, { mode: 0o600 })
    return 'installed'
  } catch (err) {
    console.error('[motor] no se pudo instalar «Lazunox Motor.app»:', err instanceof Error ? err.message : err)
    // Si la sustitución quedó a medias, se intenta devolver la copia vieja.
    try {
      if (!existsSync(p.app) && existsSync(oldApp)) renameSync(oldApp, p.app)
    } catch {
      /* sin más recursos: el llamador usa la copia anidada */
    }
    return 'failed'
  } finally {
    rmSync(join(p.installDir, `.nuevo-${id}`), { recursive: true, force: true })
    rmSync(oldApp, { recursive: true, force: true })
  }
}
