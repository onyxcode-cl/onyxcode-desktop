/**
 * Handlers IPC del control remoto (`remote:*`; solo la ventana principal). Son ligeros: con la función apagada
 * no cargan `ws`, `qrcode` ni `node-datachannel` (eso lo hace `remote/loader.ts` al pulsar «Activar»).
 */
import { BrowserWindow, Notification, app, dialog, type IpcMain } from 'electron'
import { getLang } from '@shared/i18n'
import type { RemoteConfirmRequest, RemoteEventContract, RemoteInvokeContract, RemotePairRequest, RemoteState } from '@shared/ipc-remote'
import { LIMITS } from '@shared/remote/protocol'
import { capsFor } from '@shared/platform-caps'
import { settingsStore } from '../store'
import { extrasPrefs } from '../extras/prefs'
import { findMainWindow, showMainWindow, type MainWindowDeps } from '../extras/windows'
import type { OpencodeServer } from '../opencode/server'
import { ConfirmHost } from '../remote/confirm-host'
import { currentService, ensureRemote, getAudit, getDevicesStore, getOrgPolicy, offState, type RemoteHostDeps } from '../remote/loader'
import { emitTo } from './event-bus'
import { makeInvokeHandler } from './handle'

export interface RemoteHandlersDeps extends MainWindowDeps {
  server: OpencodeServer
  chatDirectory: string
}

const handle = makeInvokeHandler<RemoteInvokeContract>({ withCode: false })

function mainWindowOf(deps: MainWindowDeps): BrowserWindow | null {
  const w = deps.getMainWindow?.()
  return w && !w.isDestroyed() && BrowserWindow.getAllWindows().includes(w) ? w : null
}

function sendMain(
  deps: MainWindowDeps,
  channel: 'remote:changed' | 'remote:pairRequest' | 'remote:confirmRequest' | 'remote:confirmDismiss',
  payload: RemoteState | RemotePairRequest | RemoteConfirmRequest | RemoteEventContract['remote:confirmDismiss']
): boolean {
  // Solo la ventana principal recibe estos eventos (envío dirigido: nunca llegan al celular).
  const w = mainWindowOf(deps)
  if (!w) return false
  emitTo(w, channel, payload)
  return true
}

/** Sin ventana principal: diálogo nativo SIN padre. «Rechazar» es el botón por defecto y el de Esc. */
async function nativeConfirm(info: RemoteConfirmRequest): Promise<boolean> {
  const en = getLang() === 'en'
  const r = await dialog.showMessageBox({
    type: 'warning',
    buttons: [en ? 'Reject' : 'Rechazar', en ? 'Allow' : 'Permitir'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: en ? 'Request from your phone' : 'Petición desde tu celular',
    message: info.summary[en ? 'en' : 'es'],
    detail: [`${info.deviceName} · ${info.deviceFingerprint}`, ...info.detail].join('\n')
  })
  return r.response === 1
}

export function registerRemoteHandlers(ipcMain: IpcMain, deps: RemoteHandlersDeps): void {
  const platform = process.platform
  const supported = capsFor(platform).remote

  // Confirmaciones en el Mac: cola de T3 + interfaz real (ventana principal o, sin ella, diálogo nativo + aviso).
  const confirmHost = new ConfirmHost({
    sendToWindow: (info) => sendMain(deps, 'remote:confirmRequest', info),
    dismissInWindow: (requestId) => void sendMain(deps, 'remote:confirmDismiss', { requestId }),
    fallback: nativeConfirm,
    alert: (info) => {
      app.dock?.bounce('critical')
      if (findMainWindow(deps)) showMainWindow(deps)
      else if (Notification.isSupported()) {
        const en = getLang() === 'en'
        new Notification({ title: 'OnyxCode', body: info.summary[en ? 'en' : 'es'] }).show()
      }
    },
    audit: (e) => getAudit().append(e)
  })

  const host = (): RemoteHostDeps => ({
    confirmHost,
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

  handle(ipcMain, 'remote:confirmAction', ({ requestId, accept, remember }) => {
    confirmHost.answer(requestId, accept, remember === true)
  })
  handle(ipcMain, 'remote:setRemember', ({ deviceId, remember }) => {
    const s = currentService()
    if (s) return s.setRemember(deviceId, remember)
    if (supported && getDevicesStore().available)
      getDevicesStore().setTrust(deviceId, remember && getOrgPolicy().allowConfirmRemember12h ? Date.now() + LIMITS.rememberMs : null)
    return offState(platform)
  })
  handle(ipcMain, 'remote:resetPin', ({ deviceId }) => {
    const s = currentService()
    if (s) return s.resetPin(deviceId)
    if (supported && getDevicesStore().available) getDevicesStore().resetPin(deviceId)
    return offState(platform)
  })
  handle(ipcMain, 'remote:revokeAll', () => {
    const s = currentService()
    if (s) return s.revokeAll()
    if (supported && getDevicesStore().available) {
      const n = getDevicesStore().list().length
      getDevicesStore().revokeAll()
      if (n > 0) getAudit().append({ kind: 'revoked-all', n })
    }
    return offState(platform)
  })
  handle(ipcMain, 'remote:setDeviceTtl', ({ deviceId, days }) => {
    const s = currentService()
    if (s) return s.setDeviceTtl(deviceId, days)
    if (supported && getDevicesStore().available) getDevicesStore().setTtl(deviceId, days)
    return offState(platform)
  })
  handle(ipcMain, 'remote:auditList', (req) => (supported ? getAudit().list({ device: req?.device }) : []))
  handle(ipcMain, 'remote:getState', () => currentService()?.getState() ?? offState(platform))
  handle(ipcMain, 'remote:start', async () => {
    if (!supported || getOrgPolicy().blocked) return offState(platform)
    return (await ensureRemote(host())).start()
  })
  handle(ipcMain, 'remote:newPairing', async () => {
    if (!supported || getOrgPolicy().blocked) return offState(platform)
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
