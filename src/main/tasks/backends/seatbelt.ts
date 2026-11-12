/**
 * Backend Seatbelt (macOS, `sandbox-exec`). Extraído SIN cambios de `sandbox.ts` (F8-B81): el perfil, los
 * argumentos de `sandbox-exec`, el entorno aislado y el lanzamiento son los de antes; lo comprueba
 * `sandbox.equivalence.test.ts` contra un fixture capturado antes de la extracción.
 * 1.8.16: el perfil se pasa como texto (`-p`), ya no en un archivo temporal (`-f`): ver `seatbeltProfileText`.
 */
import { randomBytes } from 'node:crypto'
import { SandboxDenialMonitor } from '../sandbox-denials'
import { t } from '@shared/i18n'
import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedConfigModels } from '../models-cache'
import { isUnifiedAppsEnabled } from '@shared/unified-bridge'
import { buildSandboxProfile, sandboxEnv } from '../sandbox-profile'
import { ensureTaskAppDirs, ensureTaskPrivateDir } from '../private-dir'
import { bundledRipgrepPathEnv } from '../ripgrep-runtime'
import { spawnOnHost } from './spawn'
import type { SandboxBackend, SandboxDenialControl, SandboxIsolation, SandboxNetworkOptions } from './types'

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
    denialTag: network?.denialTag,
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
    // 1.8.18: la carpeta privada y sus subcarpetas tienen que ser carpetas REALES (no enlaces que la tarea dejó) ANTES de sembrar nada y
    // de armar el perfil; si no se puede garantizar, se lanza (no se arranca). Ver `private-dir.ts`.
    ensureTaskPrivateDir(isolation)
  },
  async launch(spec) {
    if (!spec.isolation) throw new Error(t('merr.task.noPrivateDir'))
    // Otra vez justo antes del perfil (por si `prepare` no corrió o algo cambió entre medias).
    const dirs = ensureTaskPrivateDir(spec.isolation)
    // Carpetas de la app en la carpeta de la tarea, reales antes del perfil (que niega renombrarlas o borrarlas). Corre después de
    // `migrateFolderScratch` (en el manager, antes de lanzar). Si alguna es un enlace o un archivo, no se arranca.
    ensureTaskAppDirs(spec.folder)
    // Catálogo de modelos (corrección tras la revisión 1): ya NO se escribe nada en la carpeta privada (antes `seedModelsCache` copiaba
    // `models.json` y `bin/rg` a `cache/opencode`, una carpeta que la tarea puede cambiar por un enlace). Igual que WSL: copia en la
    // config de la app (`userData`, de solo lectura para la tarea) y `OPENCODE_MODELS_PATH`; `OPENCODE_DISABLE_MODELS_FETCH` evita que
    // el motor intente refrescarlo (cada 60 min) escribiendo en su caché. El `rg` incluido va en el PATH (1.8.17).
    const modelsPath = seedConfigModels(spec.configDir)
    const modelsEnv: Record<string, string> = {
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      ...(modelsPath ? { OPENCODE_MODELS_PATH: modelsPath } : {})
    }
    if (!legacyCleaned) {
      legacyCleaned = true
      cleanLegacyProfiles()
    }
    const denialTag = `lzx-denial-${randomBytes(16).toString('hex')}`
    const profile = seatbeltProfileText(spec.folder, spec.isolation, spec.configDir, {
      allowedOutboundPorts: spec.outboundPorts,
      serverPort: spec.serverPort,
      allowDelete: spec.allowDelete,
      denialTag,
      extraFolders: spec.extraFolders
    })
    // `rg` incluido al principio del PATH (1.8.17): dentro del encierro el motor no puede bajarlo de internet. El perfil ya deja LEER y
    // EJECUTAR los recursos de la app (`(allow default)`); no se abre nada nuevo.
    const env = { ...spec.baseEnv, ...bundledRipgrepPathEnv(), ...sandboxEnv(dirs), ...modelsEnv, ...spec.proxyEnv, ...spec.extraEnv }
    // `-p <texto>`: sin archivo de perfil que un proceso encerrado pueda cambiar (ver `seatbeltProfileText`).
    const monitor = spec.onDenials
      ? new SandboxDenialMonitor(
          denialTag,
          spec.folder,
          spec.onDenials,
          undefined,
          { allowDelete: spec.allowDelete, extraFolders: spec.extraFolders },
          spec.onDenialUnavailable
        )
      : undefined
    if (spec.denialNotices !== false) monitor?.start()
    let child: ReturnType<typeof spawnOnHost>
    try {
      child = spawnOnHost(SANDBOX_EXEC, ['-p', profile, spec.bin, ...spec.serveArgs], spec.folder, env)
    } catch (err) {
      await monitor?.stop()
      throw err
    }
    let ended = false
    const endMonitor = (): void => {
      ended = true
      void monitor?.stop()
    }
    child.once('exit', endMonitor)
    child.once('close', endMonitor)
    child.once('error', endMonitor)
    const control: SandboxDenialControl = {
      setEnabled: (enabled) => {
        if (enabled && !ended && child.exitCode === null && child.signalCode === null) monitor?.start()
        else void monitor?.stop()
      },
      killSync: () => monitor?.killSync()
    }
    spec.onDenialControl?.(control)
    return {
      child,
      setDenialNotices: control.setEnabled,
      toHostPath: (p) => p,
      toSandboxPath: (p) => p,
      dispose: async () => {
        await monitor?.stop()
      }
    }
  }
}
