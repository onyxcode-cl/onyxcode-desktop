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
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, accessSync, constants } from 'node:fs'
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

/** Huella de la copia maestra: el sello de la firma (`CodeResources` lista el hash del ejecutable y del Info.plist) más el tamaño del ejecutable. */
export function sourceFingerprint(source: string): string | null {
  try {
    const seal = readFileSync(join(source, 'Contents', '_CodeSignature', 'CodeResources'))
    const size = statSync(exeOf(source)).size
    return createHash('sha256').update(seal).update(`:${size}`).digest('hex')
  } catch {
    return null
  }
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
export function installedMotorCurrent(p: MotorPaths): boolean {
  const want = sourceFingerprint(p.source)
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
  run?: (cmd: string, args: string[]) => void
  /** Para pruebas: identificador del proceso en los nombres temporales. */
  pid?: number
}

const defaultRun = (cmd: string, args: string[]): void => {
  execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 })
}

/**
 * Deja `Lazunox Motor.app` en `installDir` al día. Nunca lanza: devuelve `failed` y el llamador usa la copia anidada (que funciona, pero
 * a nombre de Lazunox). La sustitución es por `rename`: un motor que ya esté en marcha con la copia vieja sigue vivo hasta que salga.
 */
export function installMotorApp(p: MotorPaths, deps: MotorInstallDeps = {}): MotorInstallResult {
  const run = deps.run ?? defaultRun
  const fp = sourceFingerprint(p.source)
  if (!fp) return 'no-source'
  if (installedMotorCurrent(p)) {
    // «Al día» solo mira sello y tamaño: además se comprueba la firma completa (≈0,1 s). Si la copia fue alterada o quedó a medias, no se
    // da por buena y se reinstala desde la maestra firmada.
    try {
      run('/usr/bin/codesign', ['--verify', '--strict', p.app])
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
    rmSync(join(p.installDir, `.nuevo-${id}`), { recursive: true, force: true })
    mkdirSync(join(p.installDir, `.nuevo-${id}`), { recursive: true })
    run('/usr/bin/ditto', [p.source, tmpApp])
    // El sello de la copia debe ser válido antes de ponerla en su sitio.
    run('/usr/bin/codesign', ['--verify', '--strict', tmpApp])
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
