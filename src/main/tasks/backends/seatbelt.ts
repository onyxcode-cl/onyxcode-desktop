/**
 * Backend Seatbelt (macOS, `sandbox-exec`). Extraído SIN cambios de `sandbox.ts` (F8-B81): el perfil, los
 * argumentos de `sandbox-exec`, el entorno aislado y el lanzamiento son los de antes; lo comprueba
 * `sandbox.equivalence.test.ts` contra un fixture capturado antes de la extracción.
 * 1.8.16: el perfil se pasa como texto (`-p`), ya no en un archivo temporal (`-f`): ver `seatbeltProfileText`.
 */
import { t } from '@shared/i18n'
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedModelsCache } from '../models-cache'
import { isUnifiedAppsEnabled } from '@shared/unified-bridge'
import { buildSandboxProfile, sandboxDirs, sandboxEnv } from '../sandbox-profile'
import { spawnOnHost } from './spawn'
import type { SandboxBackend, SandboxIsolation, SandboxNetworkOptions } from './types'

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec'

export function seatbeltAvailable(): boolean {
  return process.platform === 'darwin' && existsSync(SANDBOX_EXEC)
}

/**
 * Texto del perfil Seatbelt de un servidor de Tareas. Se pasa a `sandbox-exec -p <texto>`: NO existe ningún archivo de perfil
 * (1.8.16). Antes se escribía en `<temporal del sistema>/lazunox-tasks/profile-<hex>.sb` y `sandbox-exec -f` lo leía; esa carpeta
 * es escribible desde DENTRO del encierro, así que un proceso de una tarea podía reemplazar el perfil del SIGUIENTE lanzamiento
 * (otra tarea, o el reinicio de esta) por `(allow default)` antes de que `sandbox-exec` lo leyera. Con `-p` el perfil va en los
 * argumentos del proceso y nadie de dentro puede tocarlo. Tamaño: ~10 KB normal, ~680 KB con 2000 carpetas adicionales de rutas
 * largas; si pasara de ARG_MAX (1 MB con el entorno), `spawn` falla con E2BIG y no arranca nada (nunca sin encierro).
 */
export function seatbeltProfileText(folder: string, iso: SandboxIsolation, configDir: string, network?: SandboxNetworkOptions): string {
  return buildSandboxProfile({
    folder,
    privateDir: iso.privateDir,
    userData: iso.userData,
    readOnly: [configDir],
    allowedOutboundPorts: network?.allowedOutboundPorts,
    serverPort: network?.serverPort,
    allowDelete: network?.allowDelete,
    extraFolders: network?.extraFolders,
    isolateChats: isUnifiedAppsEnabled()
  })
}

/** Carpeta donde versiones anteriores (hasta 1.8.15) escribían los perfiles. */
export const LEGACY_PROFILE_DIR = join(tmpdir(), 'lazunox-tasks')
const LEGACY_PROFILE_NAME = /^profile-[0-9a-f]{12}\.sb$/

/**
 * Borra los perfiles que dejaron versiones anteriores en `dir` (solo `profile-<12 hex>.sb`) y la carpeta si queda vacía. Esa
 * carpeta es escribible desde dentro del encierro: si no es una carpeta real (p. ej. un enlace simbólico), no se toca. Nunca lanza.
 * Devuelve cuántos archivos borró.
 */
export function cleanLegacyProfiles(dir = LEGACY_PROFILE_DIR): number {
  let removed = 0
  try {
    if (!lstatSync(dir).isDirectory()) return 0
    for (const name of readdirSync(dir)) {
      if (!LEGACY_PROFILE_NAME.test(name)) continue
      try {
        rmSync(join(dir, name), { force: true })
        removed++
      } catch {
        /* en uso o sin permiso: se sigue */
      }
    }
    rmdirSync(dir) // solo si quedó vacía
  } catch {
    /* no existe, no está vacía o no se puede: nada que hacer */
  }
  return removed
}

let legacyCleaned = false

export const seatbeltBackend: SandboxBackend = {
  id: 'seatbelt',
  async status() {
    return seatbeltAvailable() ? { state: 'ready' } : { state: 'unsupported', detail: 'sandbox-exec' }
  },
  prepare(isolation) {
    const dirs = sandboxDirs(isolation.privateDir)
    for (const d of [dirs.config, dirs.data, dirs.cache, dirs.state, dirs.tmp]) mkdirSync(d, { recursive: true })
    seedModelsCache(dirs.cache)
  },
  async launch(spec) {
    if (!spec.isolation) throw new Error(t('merr.task.noPrivateDir'))
    const dirs = sandboxDirs(spec.isolation.privateDir)
    seedModelsCache(dirs.cache)
    if (!legacyCleaned) {
      legacyCleaned = true
      cleanLegacyProfiles()
    }
    const profile = seatbeltProfileText(spec.folder, spec.isolation, spec.configDir, {
      allowedOutboundPorts: spec.outboundPorts,
      serverPort: spec.serverPort,
      allowDelete: spec.allowDelete,
      extraFolders: spec.extraFolders
    })
    const env = { ...spec.baseEnv, ...sandboxEnv(dirs), ...spec.proxyEnv, ...spec.extraEnv }
    // `-p <texto>`: sin archivo de perfil que un proceso encerrado pueda cambiar (ver `seatbeltProfileText`).
    const child = spawnOnHost(SANDBOX_EXEC, ['-p', profile, spec.bin, ...spec.serveArgs], spec.folder, env)
    return {
      child,
      toHostPath: (p) => p,
      toSandboxPath: (p) => p,
      dispose: async () => {}
    }
  }
}
