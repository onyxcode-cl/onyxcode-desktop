import { app, BrowserWindow, dialog, net, safeStorage, shell, type IpcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import { ACCOUNT_API, APP_NAME } from '@shared/brand'
import { setAccountAccessCheck } from '../account/access'
import { createAccountClient } from '../account/client'
import { resolveAccountConfig } from '../account/config'
import { startLoopback } from '../account/loopback'
import { AccountService, AccountUserError } from '../account/service'
import { createAccountStore, isPlainTestStore } from '../account/store'
import { hideQuickEntry } from '../extras/quick-entry'
import type { IpcInvokeContract } from '@shared/ipc'
import { broadcast, IpcError, makeInvokeHandler } from './handle'

/** Como `handle`, pero los errores pensados para el usuario (código malo, sin red…) no se vuelcan a la consola. */
const handle = makeInvokeHandler<IpcInvokeContract>({
  withCode: true,
  errorCode: (err) => (err instanceof IpcError ? err.code : undefined),
  silent: (err) => err instanceof AccountUserError
})

/**
 * Cuenta: servicio en main + canales `account:*`. Con `ACCOUNT_API = null` el servicio queda
 * apagado (no exige login, no hace peticiones y `isAllowed()` es siempre true).
 */
export function registerAccountHandlers(ipcMain: IpcMain): AccountService {
  const config = resolveAccountConfig({ isPackaged: app.isPackaged, env: process.env, api: ACCOUNT_API })
  const client = createAccountClient({
    baseUrl: config.baseUrl,
    // net.fetch: pila de red de Chromium desde main (la CSP del renderer no deja salir a internet).
    fetch: (url, init) => net.fetch(url, init),
    userAgent: `${APP_NAME}/${app.getVersion()}`
  })
  const store = createAccountStore({
    dir: app.getPath('userData'),
    safeStorage,
    plainTest: isPlainTestStore({ isPackaged: app.isPackaged, env: process.env })
  })
  const svc = new AccountService({
    config,
    client,
    store,
    now: () => Date.now(),
    setRepeating: (fn, ms) => {
      const t = setInterval(fn, ms)
      t.unref?.()
      return () => clearInterval(t)
    },
    openExternal: (url) => shell.openExternal(url),
    startLoopback,
    saveExport: async (json, suggestedName) => {
      const parent = BrowserWindow.getFocusedWindow()
      const options: Electron.SaveDialogOptions = {
        title: 'Descargar mis datos',
        defaultPath: suggestedName,
        filters: [{ name: 'JSON', extensions: ['json'] }]
      }
      const r = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
      if (r.canceled || !r.filePath) return false
      await writeFile(r.filePath, json, { encoding: 'utf8', mode: 0o600 })
      return true
    },
    onState: (s) => {
      broadcast('account:changed', s)
      // Si la cuenta deja de valer, Quick Entry no puede quedarse abierta.
      if (!svc.isAllowed()) hideQuickEntry()
    }
  })
  setAccountAccessCheck(() => svc.isAllowed())

  handle(ipcMain, 'account:state', () => svc.getState())
  handle(ipcMain, 'account:google', () => svc.signInGoogle())
  handle(ipcMain, 'account:cancel', () => svc.cancel())
  handle(ipcMain, 'account:retry', async () => {
    await svc.validate()
    return svc.getState()
  })
  handle(ipcMain, 'account:emailStart', ({ email }) => svc.emailStart(email))
  handle(ipcMain, 'account:emailVerify', ({ email, code }) => svc.emailVerify(email, code))
  handle(ipcMain, 'account:signOut', () => svc.signOut())
  handle(ipcMain, 'account:delete', () => svc.deleteAccount())
  handle(ipcMain, 'account:export', () => svc.exportData())

  app.on('will-quit', () => svc.stop())
  void svc.start()
  return svc
}
