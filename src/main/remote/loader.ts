/**
 * Carga perezosa del control remoto. Este módulo es ligero (sin `ws`, `qrcode` ni `node-datachannel`): decide si
 * hay que cargar `./index` y mantiene el estado «apagado» sin tocar la red. Con la función apagada no hay
 * puertos, sockets ni módulos nativos cargados.
 */
import { app, safeStorage } from 'electron'
import { join } from 'node:path'
import { capsFor } from '@shared/platform-caps'
import { REMOTE_OFF_STATE, type RemoteState } from '@shared/ipc-remote'
import { DevicesStore, REMOTE_FILE } from './devices-store'
import type { RemoteBootDeps } from './index'
import type { RemoteService } from './service'

export type RemoteHostDeps = Pick<
  RemoteBootDeps,
  'chatDirectory' | 'startEngine' | 'getConnection' | 'getRecentFolders' | 'modelFor' | 'onChanged' | 'onPairRequest'
>

let devicesStore: DevicesStore | null = null
let service: RemoteService | null = null
let booting: Promise<RemoteService> | null = null
let lastMode: RemoteState['mode'] = 'off'
const modeListeners = new Set<(mode: RemoteState['mode']) => void>()

export function getDevicesStore(): DevicesStore {
  devicesStore ??= new DevicesStore(join(app.getPath('userData'), REMOTE_FILE), safeStorage)
  return devicesStore
}

/** Carpeta de la PWA: `Contents/Resources/pwa` empaquetada, `pwa/dist` en desarrollo. */
export function pwaDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'pwa') : join(app.getAppPath(), 'pwa', 'dist')
}

/** Estado con la función apagada: no carga nada de red. */
export function offState(platform: string = process.platform): RemoteState {
  if (!capsFor(platform).remote) return { ...REMOTE_OFF_STATE, available: false, unavailable: 'platform' }
  const devices = getDevicesStore()
  if (!devices.available) return { ...REMOTE_OFF_STATE, available: false, unavailable: 'no-safe-storage' }
  return {
    ...REMOTE_OFF_STATE,
    devices: devices.list().map((d) => ({ id: d.id, name: d.name, createdAt: d.createdAt, lastSeenAt: d.lastSeenAt, connected: false }))
  }
}

export function currentService(): RemoteService | null {
  return service
}

export function onRemoteMode(cb: (mode: RemoteState['mode']) => void): () => void {
  modeListeners.add(cb)
  return () => modeListeners.delete(cb)
}

export function remoteMode(): RemoteState['mode'] {
  return lastMode
}

/** Avisa de un cambio de estado (actualiza bandeja y oyentes). */
export function noteState(state: RemoteState): void {
  if (state.mode !== lastMode) {
    lastMode = state.mode
    for (const cb of modeListeners) cb(lastMode)
  }
}

/** Carga el módulo (la primera vez) y devuelve el servicio. */
export function ensureRemote(host: RemoteHostDeps): Promise<RemoteService> {
  if (service) return Promise.resolve(service)
  booting ??= import('./index')
    .then((m) =>
      m.createRemote({
        ...host,
        devices: getDevicesStore(),
        pwaDir: pwaDir(),
        onChanged: (s) => {
          noteState(s)
          host.onChanged(s)
        }
      })
    )
    .then((s) => {
      service = s
      return s
    })
    .finally(() => {
      booting = null
    })
  return booting
}

/** «Cortar todo» (atajo, bandeja, Ajustes). No hace nada si la función nunca se activó. */
export async function stopAllRemote(): Promise<void> {
  await service?.stopAll()
}

/** Al salir de la app. */
export async function disposeRemote(): Promise<void> {
  await service?.dispose()
}
