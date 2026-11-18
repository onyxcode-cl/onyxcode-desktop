import { app, safeStorage } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { KeyboxSafeStorage, makeKeyboxFetcher } from '../remote/keybox-storage'
import { ImageSearchStore } from './image-search-store'
let store: ImageSearchStore | undefined
export function videoImageSearchStore(): ImageSearchStore {
  if (store) return store
  const helper = join(process.resourcesPath ?? '', 'keybox', 'lazunox-keybox')
  const safe =
    process.platform === 'darwin' && app.isPackaged && existsSync(helper)
      ? new KeyboxSafeStorage(makeKeyboxFetcher(helper), safeStorage)
      : safeStorage
  return (store = new ImageSearchStore(app.getPath('userData'), safe))
}
