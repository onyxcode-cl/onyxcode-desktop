/** Instancia única de la Ficha del proyecto (nivel de acceso y Bóveda) con el almacén seguro de la app. */
import { app, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SafeStorageLike } from '../remote/devices-store'
import { KeyboxSafeStorage, makeKeyboxFetcher } from '../remote/keybox-storage'
import { ProjectProfileStore } from './store'

export { ProjectProfileStore } from './store'
export type { AccessLevel } from './store'

/**
 * El mismo almacén seguro que ya usan los celulares vinculados y Telegram: en macOS empaquetado, el auxiliar del Llavero cuya identidad no
 * cambia entre versiones (sin preguntas nuevas tras cada actualización); si falta, `safeStorage` de Electron.
 */
function vaultSafeStorage(): SafeStorageLike {
  if (process.platform !== 'darwin' || !app.isPackaged) return safeStorage
  const helper = join(process.resourcesPath, 'keybox', 'lazunox-keybox')
  if (!existsSync(helper)) return safeStorage
  return new KeyboxSafeStorage(makeKeyboxFetcher(helper), safeStorage)
}

let store: ProjectProfileStore | null = null
export function projectProfiles(): ProjectProfileStore {
  if (!store) store = new ProjectProfileStore(app.getPath('userData'), vaultSafeStorage())
  return store
}
