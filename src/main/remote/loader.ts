/**
 * Carga perezosa del control remoto. Este módulo es ligero (sin `ws`, `qrcode` ni `node-datachannel`): decide si
 * hay que cargar `./index` y mantiene el estado «apagado» sin tocar la red. Con la función apagada no hay
 * puertos, sockets ni módulos nativos cargados.
 */
import { app, powerSaveBlocker, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { capsFor } from '@shared/platform-caps'
import { REMOTE_OFF_STATE, type RemotePolicyView, type RemoteState } from '@shared/ipc-remote'
import { AUDIT_FILE, AuditLog } from './audit'
import { DevicesStore, REMOTE_FILE, toDeviceInfo, type SafeStorageLike } from './devices-store'
import { KeyboxSafeStorage, makeKeyboxFetcher } from './keybox-storage'
import { createKeepAwake, type KeepAwake } from './keep-awake'
import { OrgRemotePolicy } from './org-policy'
import { policyFile } from '../tasks/policy'
import type { RemoteBootDeps } from './index'
import type { RemoteService } from './service'

export type RemoteHostDeps = Pick<
  RemoteBootDeps,
  | 'chatDirectory'
  | 'startEngine'
  | 'getConnection'
  | 'getRecentFolders'
  | 'modelFor'
  | 'onChanged'
  | 'onPairRequest'
  | 'confirmHost'
  | 'confirmEnableApprove'
>

let devicesStore: DevicesStore | null = null
let orgPolicy: OrgRemotePolicy | null = null
let auditLog: AuditLog | null = null
let service: RemoteService | null = null
let booting: Promise<RemoteService> | null = null
let lastMode: RemoteState['mode'] = 'off'
const modeListeners = new Set<(mode: RemoteState['mode']) => void>()

/**
 * Cifrado del archivo de celulares. En macOS empaquetado, con el auxiliar `lazunox-keybox` (su identidad no cambia entre versiones, así que el
 * Llavero no vuelve a preguntar tras cada actualización); si falta o rechaza, `safeStorage` de Electron como antes. Windows y desarrollo: `safeStorage`.
 */
function devicesSafeStorage(): SafeStorageLike {
  if (process.platform !== 'darwin' || !app.isPackaged) return safeStorage
  const helper = join(process.resourcesPath, 'keybox', 'lazunox-keybox')
  if (!existsSync(helper)) return safeStorage
  return new KeyboxSafeStorage(makeKeyboxFetcher(helper), safeStorage)
}

export function getDevicesStore(): DevicesStore {
  if (!devicesStore) {
    devicesStore = new DevicesStore(join(app.getPath('userData'), REMOTE_FILE), devicesSafeStorage())
    // Un vínculo del modo viaje solo vale para su túnel: tras una salida sin limpiar (caída de la app) no debe sobrevivir.
    try {
      devicesStore.revokeTravel()
    } catch {
      /* sin cifrado no hay nada guardado */
    }
  }
  return devicesStore
}

/** Política de la organización (`managed.json`, bloque `remote`), releída cuando el archivo cambia. */
export function getOrgPolicy(): RemotePolicyView {
  orgPolicy ??= new OrgRemotePolicy(policyFile)
  return orgPolicy.get()
}

/** Auditoría `userData/remote-audit.jsonl` (rotada, sin secretos). */
export function getAudit(): AuditLog {
  auditLog ??= new AuditLog(join(app.getPath('userData'), AUDIT_FILE))
  return auditLog
}

/** Carpeta de la PWA: `Contents/Resources/pwa` empaquetada, `pwa/dist` en desarrollo. */
export function pwaDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'pwa') : join(app.getAppPath(), 'pwa', 'dist')
}

let remoteWinOn = false

/** `main` fija la bandera efectiva `remoteWin` al arrancar (`remote-win-flag.ts`); hace falta reiniciar para que cambie. */
export function setRemoteWin(on: boolean): void {
  remoteWinOn = on === true
}

/** ¿Existe el control remoto en esta plataforma? macOS siempre; Windows solo con `remoteWin`. */
export function remoteSupported(platform: string = process.platform): boolean {
  return capsFor(platform, { remoteWin: remoteWinOn }).remote
}

/** Estado con la función apagada: no carga nada de red. */
export function offState(platform: string = process.platform): RemoteState {
  if (!remoteSupported(platform)) return { ...REMOTE_OFF_STATE, available: false, unavailable: 'platform' }
  const policy = getOrgPolicy()
  const withPolicy = policy.managed ? { policy } : {}
  if (policy.blocked)
    return {
      ...REMOTE_OFF_STATE,
      available: false,
      unavailable: 'policy',
      confirmEachConnection: policy.requireConnectionConfirm,
      confirmEachForced: policy.requireConnectionConfirm,
      ...withPolicy
    }
  const devices = getDevicesStore()
  const forced = policy.requireConnectionConfirm
  // Sin nada vinculado no se pregunta por el cifrado (tocaría el Llavero al arrancar): se comprueba al activar el Celular.
  if (devices.hasData && !devices.available)
    return {
      ...REMOTE_OFF_STATE,
      available: false,
      unavailable: 'no-safe-storage',
      confirmEachConnection: forced,
      confirmEachForced: forced,
      ...withPolicy
    }
  const cloud = devices.getCloudPrefs()
  const outsideBlocked = !policy.allowOutsideNetwork ? 'policy' : policy.requirePasskey ? 'passkey-required' : null
  return {
    ...REMOTE_OFF_STATE,
    confirmEachConnection: forced || devices.getPrefs().confirmEachConnection,
    confirmEachForced: forced,
    devices: devices.list().map((d) => toDeviceInfo(d, false, null, Date.now(), policy.deviceTtlDays)),
    connection: cloud.connection,
    away: cloud.away,
    ...(outsideBlocked ? { outsideBlocked } : {}),
    ...withPolicy
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

let keepAwake: KeepAwake | null = null
/** «Mantener despierto» (solo Windows con `remoteWin`; ver `keep-awake.ts`). En macOS ni se crea. */
function keepAwakeFor(): KeepAwake | null {
  if (process.platform !== 'win32') return null
  keepAwake ??= createKeepAwake({ platform: process.platform, enabled: () => remoteWinOn, blocker: powerSaveBlocker })
  return keepAwake
}

/** Avisa de un cambio de estado (actualiza bandeja y oyentes). */
export function noteState(state: RemoteState): void {
  keepAwakeFor()?.update(state.mode)
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
        audit: (e) => getAudit().append(e),
        policy: getOrgPolicy,
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
  keepAwake?.release()
  await service?.dispose()
}
