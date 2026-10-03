/**
 * Handlers IPC del control remoto (`remote:*`; solo la ventana principal). Son ligeros: con la función apagada
 * no cargan `ws`, `qrcode` ni `node-datachannel` (eso lo hace `remote/loader.ts` al pulsar «Activar»).
 */
import { BrowserWindow, type IpcMain } from 'electron'
import type { RemoteInvokeContract, RemotePairRequest, RemoteState } from '@shared/ipc-remote'
import { capsFor } from '@shared/platform-caps'
import { settingsStore } from '../store'
import { extrasPrefs } from '../extras/prefs'
import { showMainWindow, type MainWindowDeps } from '../extras/windows'
import type { OpencodeServer } from '../opencode/server'
import { currentService, ensureRemote, getDevicesStore, offState, type RemoteHostDeps } from '../remote/loader'
import { makeInvokeHandler } from './handle'

export interface RemoteHandlersDeps extends MainWindowDeps {
  server: OpencodeServer
  chatDirectory: string
}

const handle = makeInvokeHandler<RemoteInvokeContract>({ withCode: false })

function sendMain(deps: MainWindowDeps, channel: 'remote:changed' | 'remote:pairRequest', payload: RemoteState | RemotePairRequest): void {
  for (const w of BrowserWindow.getAllWindows()) {
    // Solo la ventana principal recibe estos eventos.
    if (w.isDestroyed()) continue
    if (deps.getMainWindow?.() === w) w.webContents.send(channel, payload)
  }
}

export function registerRemoteHandlers(ipcMain: IpcMain, deps: RemoteHandlersDeps): void {
  const platform = process.platform
  const supported = capsFor(platform).remote

  const host = (): RemoteHostDeps => ({
    chatDirectory: deps.chatDirectory,
    startEngine: () => deps.server.start(),
    getConnection: () => deps.server.getConnection(),
    getRecentFolders: () => settingsStore.get().recentFolders,
    modelFor: (kind) => extrasPrefs.get().modelsByMode[kind] ?? settingsStore.get().defaultModel,
    onChanged: (s) => sendMain(deps, 'remote:changed', s),
    onPairRequest: (req) => {
      // El dueño debe ver la confirmación: trae la ventana al frente.
      showMainWindow(deps)
      sendMain(deps, 'remote:pairRequest', req)
    }
  })

  handle(ipcMain, 'remote:getState', () => currentService()?.getState() ?? offState(platform))
  handle(ipcMain, 'remote:start', async () => {
    if (!supported) return offState(platform)
    return (await ensureRemote(host())).start()
  })
  handle(ipcMain, 'remote:newPairing', async () => {
    if (!supported) return offState(platform)
    return (await ensureRemote(host())).newPairing()
  })
  handle(ipcMain, 'remote:stop', async () => {
    const s = currentService()
    return s ? s.stopAll() : offState(platform)
  })
  handle(ipcMain, 'remote:confirmPair', ({ requestId, accept }) => {
    const s = currentService()
    return s ? s.confirmPair(requestId, accept) : offState(platform)
  })
  handle(ipcMain, 'remote:revoke', ({ deviceId }) => {
    const s = currentService()
    if (s) return s.revoke(deviceId)
    if (supported && getDevicesStore().available) getDevicesStore().revoke(deviceId)
    return offState(platform)
  })
}
