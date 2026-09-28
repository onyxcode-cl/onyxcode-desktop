import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { BrowserWindow } from 'electron'
import type {
  IpcErrorCode,
  IpcEventChannel,
  IpcEventContract,
  IpcInvokeChannel,
  IpcRequest,
  IpcResponse,
  IpcResult
} from '@shared/ipc'
import { guardInvoke, IpcGuardError } from './guard'

/** Error con código IPC explícito (p.ej. NOT_READY). */
export class IpcError extends Error {
  constructor(
    readonly code: IpcErrorCode,
    message: string
  ) {
    super(message)
  }
}

export class NotImplementedError extends IpcError {
  constructor(channel: string) {
    super('NOT_IMPLEMENTED', `"${channel}" aún no está implementado`)
  }
}

type Handler<C extends IpcInvokeChannel> = (
  req: IpcRequest<C>,
  event: IpcMainInvokeEvent
) => IpcResponse<C> | Promise<IpcResponse<C>>

/**
 * Registra un handler tipado; valida emisor y payload (`guardInvoke`), envuelve el resultado en
 * IpcResult y captura errores.
 */
export function handle<C extends IpcInvokeChannel>(ipcMain: IpcMain, channel: C, handler: Handler<C>): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<IpcResponse<C>>> => {
    try {
      const req = guardInvoke(event, channel, args) as IpcRequest<C>
      return { ok: true, data: await handler(req, event) }
    } catch (err) {
      if (err instanceof IpcGuardError) return { ok: false, code: err.kind, error: err.message }
      if (err instanceof IpcError) return { ok: false, code: err.code, error: err.message }
      console.error(`[ipc] ${channel}:`, err)
      return { ok: false, code: 'ERROR', error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/** Registra un canal como placeholder que responde NOT_IMPLEMENTED. */
export function notImplemented<C extends IpcInvokeChannel>(ipcMain: IpcMain, channel: C): void {
  handle(ipcMain, channel, () => {
    throw new NotImplementedError(channel)
  })
}

/** Envía un evento tipado a un webContents concreto. */
export function sendTo<C extends IpcEventChannel>(wc: WebContents, channel: C, payload: IpcEventContract[C]): void {
  if (!wc.isDestroyed()) wc.send(channel, payload)
}

/** Envía un evento tipado a todas las ventanas. */
export function broadcast<C extends IpcEventChannel>(channel: C, payload: IpcEventContract[C]): void {
  for (const win of BrowserWindow.getAllWindows()) sendTo(win.webContents, channel, payload)
}
