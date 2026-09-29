/**
 * Handlers IPC del navegador integrado (`browser:*`, Lote D, B.4). Registrar en main con
 * `registerBrowserHandlers(ipcMain)`. La política y el estado viven en `embedded-browser/service.ts`;
 * este archivo solo valida el emisor (vía `guardInvoke`, igual que el resto de canales) y traduce
 * cada canal a su función correspondiente.
 */
import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from 'electron'
import type { BrowserInvokeChannel, BrowserInvokeContract, IpcBrowserResult } from '@shared/ipc-browser'
import * as svc from '../embedded-browser/service'
import { guardInvoke, IpcGuardError } from './guard'

type Req<C extends BrowserInvokeChannel> = BrowserInvokeContract[C]['req']
type Res<C extends BrowserInvokeChannel> = BrowserInvokeContract[C]['res']

function handle<C extends BrowserInvokeChannel>(
  ipcMain: IpcMain,
  channel: C,
  handler: (req: Req<C>, event: IpcMainInvokeEvent) => Res<C> | Promise<Res<C>>
): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcBrowserResult<Res<C>>> => {
    try {
      const req = guardInvoke(event, channel, args) as Req<C>
      return { ok: true, data: await handler(req, event) }
    } catch (err) {
      if (err instanceof IpcGuardError) return { ok: false, error: err.message }
      console.error(`[ipc] ${channel}:`, err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

export function registerBrowserHandlers(ipcMain: IpcMain): void {
  handle(ipcMain, 'browser:state', ({ owner }) => svc.getOwnerState(owner))
  handle(ipcMain, 'browser:attach', ({ owner, rect, visible }, event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) svc.attachView(owner, win, rect, visible)
  })
  handle(ipcMain, 'browser:detach', ({ owner }) => {
    svc.detachView(owner)
  })
  handle(ipcMain, 'browser:newTab', ({ owner, input }) => svc.newTab(owner, input))
  handle(ipcMain, 'browser:closeTab', ({ owner, tabId }) => svc.closeTab(owner, tabId))
  handle(ipcMain, 'browser:selectTab', ({ owner, tabId }) => svc.selectTab(owner, tabId))
  handle(ipcMain, 'browser:navigate', ({ owner, tabId, input }) => svc.navigate(owner, tabId, input))
  handle(ipcMain, 'browser:history', ({ owner, tabId, action }) => {
    svc.history(owner, tabId, action)
  })
  handle(ipcMain, 'browser:agent', ({ owner, action }) => svc.agentControl(owner, action))
  handle(ipcMain, 'browser:pick', ({ owner, tabId, on }) => svc.setPicking(owner, tabId, on))
  handle(ipcMain, 'browser:capture', ({ owner, tabId }) => svc.captureForUi(owner, tabId))
  handle(ipcMain, 'browser:toChat', (payload) => {
    svc.toChat(payload)
  })
  handle(ipcMain, 'browser:respond', ({ id, decision }) => {
    svc.respond(id, decision)
  })
  handle(ipcMain, 'browser:popOut', ({ owner, on }) => svc.popOut(owner, on))
  handle(ipcMain, 'browser:openExternal', ({ owner, tabId }) => {
    svc.openExternalTab(owner, tabId)
  })
  handle(ipcMain, 'browser:devServers', ({ directory }) => svc.devServersFor(directory))
  handle(ipcMain, 'browser:sites:get', () => svc.sitesState())
  handle(ipcMain, 'browser:sites:setPrefs', (patch) => svc.setSitesPrefs(patch))
  handle(ipcMain, 'browser:sites:remove', ({ product, site }) => svc.removeSiteFor(product, site))
  handle(ipcMain, 'browser:sites:undeny', ({ product, site }) => svc.undenySiteFor(product, site))
  handle(ipcMain, 'browser:sites:removeLocal', ({ origin }) => svc.removeLocalOriginFor(origin))
  handle(ipcMain, 'browser:clearData', ({ product }) => svc.clearProductData(product))
}
