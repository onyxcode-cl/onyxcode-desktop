/**
 * Entorno de la «última milla» de la Ola A para el sidecar principal (Chat y Code): búsqueda web con cualquier IA, sugerencia en las tarjetas de
 * permiso y política de empresa del motor. La lógica de las variables vive en `@shared/engine-lastmile-env` (pura); aquí solo se mira el disco
 * (¿existe el archivo del administrador?) y el entorno. Lo usan `server.ts` (al lanzar) y `engine-flags-restart.ts` (para saber si hay que reiniciar).
 *
 * Política de empresa (decisión D12): solo la ruta de ADMINISTRADOR. «Existe» es todo menos «no hay nada»: un error al mirar (permisos, disco)
 * cuenta como que existe y el motor decide (un archivo ilegible = política ROTA = deniega todo, falla cerrado). Un enlace simbólico en esa ruta
 * lo habrá puesto un administrador; no se resuelve aquí.
 */
import { app } from 'electron'
import { lstatSync } from 'node:fs'
import { enginePolicyPath, engineLastMileEnvFor, type EnginePolicyProbe, type LastMileSettings } from '@shared/engine-lastmile-env'

/** Variable SOLO de desarrollo (`!app.isPackaged`) para probar la política sin ser administrador. En la app empaquetada se ignora siempre. */
export const DEV_POLICY_OVERRIDE_VAR = 'LAZUNOX_MOTOR_POLICY'

const isPackaged = (): boolean => {
  try {
    return app.isPackaged !== false
  } catch {
    return true // sin Electron (pruebas) o ante la duda: como empaquetada, sin override
  }
}

/** ¿Hay algo en `p`? Solo `ENOENT`/`ENOTDIR` cuentan como «no hay»; cualquier otro error, como «hay». */
export function pathPresent(p: string): boolean {
  try {
    lstatSync(p)
    return true
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code
    return !(code === 'ENOENT' || code === 'ENOTDIR')
  }
}

/** Mira el disco y el entorno para la política del administrador. */
export function adminPolicyProbe(
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
  present: (p: string) => boolean = pathPresent
): EnginePolicyProbe {
  const override = !isPackaged() ? env[DEV_POLICY_OVERRIDE_VAR] : undefined
  const path =
    override && (override.startsWith('/') || /^[A-Za-z]:[\\/]/.test(override) || override.startsWith('\\\\'))
      ? override
      : enginePolicyPath(platform, env)
  return { platform, exists: present(path), env, devOverride: path === override ? override : undefined }
}

/** Las tres variables (búsqueda web, sugerencia y política del administrador) para el sidecar principal. */
export const engineLastMileEnv = (s: LastMileSettings): Record<string, string> => engineLastMileEnvFor(s, adminPolicyProbe())
