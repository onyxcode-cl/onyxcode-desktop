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
import { applyApproveSetting, type EnableApproveInfo } from '../remote/approve-setting'
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

/**
 * Diálogo PROPIO del Mac para encender «Aprobar comandos desde este celular». Nativo (no lo pinta ninguna página, así que ni el
 * celular ni un renderer comprometido pueden pulsarlo). «Cancelar» es el botón por defecto y el de Esc; un fallo = no se enciende.
 */
async function confirmEnableApprove(deps: MainWindowDeps, info: EnableApproveInfo): Promise<boolean> {
  const en = getLang() === 'en'
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: [en ? 'Cancel' : 'Cancelar', en ? 'Allow commands from this phone' : 'Permitir comandos desde este celular'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: en ? 'Approve commands from this phone' : 'Aprobar comandos desde este celular',
    message: en
      ? `"${info.deviceName}" will be able to approve the agent's commands and edits while you are away.`
      : `«${info.deviceName}» podrá aprobar comandos y ediciones del agente mientras estés fuera.`,
    detail: en
      ? [
          'Without this, every command or edit the agent asks for must be confirmed on this Mac.',
          'With it, the phone approves them by itself, except those that look sensitive (sudo, ssh, deleting outside the project, secrets…), which still ask here. Up to 20 per hour.',
          'The filter is a heuristic, not a guarantee: a command it lets through can still run whatever the project defines. Turn it off in Settings or with "Cut everything".',
          `Phone: ${info.deviceName} · ${info.fingerprint}`
        ].join('\n\n')
      : [
          'Sin esto, cada comando o edición que pida el agente debe confirmarse en este Mac.',
          'Con esto, el celular los aprueba solo, salvo los que parezcan delicados (sudo, ssh, borrar fuera del proyecto, secretos…), que siguen preguntando aquí. Hasta 20 por hora.',
          'El filtro es una heurística, no una garantía: un comando que deje pasar puede ejecutar lo que el proyecto defina. Se apaga en Ajustes o con «Cortar todo».',
          `Celular: ${info.deviceName} · ${info.fingerprint}`
        ].join('\n\n')
  }
  try {
    const w = mainWindowOf(deps)
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts)
    return r.response === 1
  } catch {
    return false
  }
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
    confirmEnableApprove: (info) => confirmEnableApprove(deps, info),
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
  handle(ipcMain, 'remote:setConfirmEach', ({ on }) => {
    const s = currentService()
    if (s) return s.setConfirmEach(on)
    if (supported && getDevicesStore().available && !getOrgPolicy().requireConnectionConfirm) {
      const store = getDevicesStore()
      store.setPrefs({ confirmEachConnection: on })
      // Apagarlo borra también la confianza de 12 h (deja de tener sentido).
      if (!on) store.clearAllTrust()
    }
    return offState(platform)
  })
  handle(ipcMain, 'remote:setApproveCommands', async ({ deviceId, on }) => {
    const s = currentService()
    if (s) return s.setApproveCommands(deviceId, on)
    if (supported && getDevicesStore().available) {
      await applyApproveSetting(
        { devices: getDevicesStore(), audit: (e) => getAudit().append(e), confirmEnable: (info) => confirmEnableApprove(deps, info) },
        deviceId,
        on
      )
    }
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
  handle(ipcMain, 'remote:setConnection', async ({ connection }) => {
    if (!supported || getOrgPolicy().blocked) return offState(platform)
    const s = currentService()
    if (s) return s.setConnection(connection)
    if (getDevicesStore().available) getDevicesStore().setCloudPrefs({ connection })
    return offState(platform)
  })
  handle(ipcMain, 'remote:setAway', async ({ on }) => {
    if (!supported || getOrgPolicy().blocked) return offState(platform)
    // Encender arranca el servicio ya (si hay celulares y la política lo permite); apagar no necesita cargar nada.
    if (on) return (await ensureRemote(host())).setAway(true)
    const s = currentService()
    if (s) return s.setAway(false)
    if (getDevicesStore().available) getDevicesStore().setCloudPrefs({ away: false })
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

  // «Disponible fuera de casa»: al abrir la app, si está elegido, el servicio arranca SIN QR (hay celulares vinculados y la política
  // lo permite). Con un pequeño retraso para no cargar nada en el arranque; sin la opción encendida no se carga nada.
  if (supported) {
    const t = setTimeout(() => {
      try {
        const store = getDevicesStore()
        const p = getOrgPolicy()
        const c = store.available ? store.getCloudPrefs() : null
        if (c?.away && c.connection === 'cloud' && !p.blocked && p.allowOutsideNetwork && !p.requirePasskey && store.list().length > 0)
          void ensureRemote(host())
            .then((s) => s.autoStartAway())
            .catch(() => undefined)
      } catch {
        /* sin cifrado o sin permiso: no se enciende solo */
      }
    }, 4000)
    t.unref?.()
  }
}
