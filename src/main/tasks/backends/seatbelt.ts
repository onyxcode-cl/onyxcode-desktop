/**
 * Backend Seatbelt (macOS, `sandbox-exec`). Extraído SIN cambios de `sandbox.ts` (F8-B81): el perfil, los
 * argumentos de `sandbox-exec`, el entorno aislado y el lanzamiento son los de antes; lo comprueba
 * `sandbox.equivalence.test.ts` contra un fixture capturado antes de la extracción.
 */
import { t } from '@shared/i18n'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

/** Escribe el perfil en un archivo temporal y devuelve su ruta. */
export function writeSandboxProfile(
  folder: string,
  iso: SandboxIsolation,
  configDir: string,
  network?: SandboxNetworkOptions,
  dir = join(tmpdir(), 'lazunox-tasks')
): string {
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `profile-${randomBytes(6).toString('hex')}.sb`)
  const profile = buildSandboxProfile({
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
  writeFileSync(file, profile, 'utf8')
  return file
}

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
    const profile = writeSandboxProfile(spec.folder, spec.isolation, spec.configDir, {
      allowedOutboundPorts: spec.outboundPorts,
      serverPort: spec.serverPort,
      allowDelete: spec.allowDelete,
      extraFolders: spec.extraFolders
    })
    const env = { ...spec.baseEnv, ...sandboxEnv(dirs), ...spec.proxyEnv, ...spec.extraEnv }
    const child = spawnOnHost(SANDBOX_EXEC, ['-f', profile, spec.bin, ...spec.serveArgs], spec.folder, env)
    return {
      child,
      toHostPath: (p) => p,
      toSandboxPath: (p) => p,
      dispose: async () => {
        rmSync(profile, { force: true })
      }
    }
  }
}
