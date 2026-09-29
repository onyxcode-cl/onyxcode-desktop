import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { BrowserWindow } from 'electron'
import type { IpcErrorCode, IpcEventChannel, IpcEventContract, IpcInvokeContract } from '@shared/ipc'
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

type Contract<K> = { [P in keyof K]: { req: unknown; res: unknown } }

export interface InvokeHandlerOptions {
  /** Incluye `code` en el resultado de error (los preloads de extras/browser lo desenvuelven sin él). */
  withCode: boolean
  /** Código propio para un error concreto (p.ej. `IpcError`); si devuelve undefined -> 'ERROR'. */
  errorCode?: (err: unknown) => IpcErrorCode | undefined
  /** true = no imprimir el error en consola (errores esperables). */
  silent?: (err: unknown) => boolean
}

/**
 * Crea el registrador `(ipcMain, canal, fn)` de un contrato: quita el handler previo, valida
 * emisor/payload (`guardInvoke`), envuelve el resultado en `{ ok, data }` y captura errores.
 */
export function makeInvokeHandler<K extends Contract<K>>(opts: InvokeHandlerOptions) {
  const fail = (code: IpcErrorCode, error: string) => (opts.withCode ? { ok: false as const, code, error } : { ok: false as const, error })
  return function handle<C extends keyof K & string>(
    ipcMain: IpcMain,
    channel: C,
    handler: (req: K[C]['req'], event: IpcMainInvokeEvent) => K[C]['res'] | Promise<K[C]['res']>
  ): void {
    ipcMain.removeHandler(channel)
    ipcMain.handle(channel, async (event, ...args: unknown[]) => {
      try {
        const req = guardInvoke(event, channel, args) as K[C]['req']
        return { ok: true as const, data: await handler(req, event) }
      } catch (err) {
        if (err instanceof IpcGuardError) return fail(err.kind, err.message)
        const code = opts.errorCode?.(err)
        if (code) return fail(code, (err as Error).message)
        if (!opts.silent?.(err)) console.error(`[ipc] ${channel}:`, err)
        return fail('ERROR', err instanceof Error ? err.message : String(err))
      }
    })
  }
}

/** Registra un handler tipado del contrato principal (`shared/ipc.ts`); mapea `IpcError` a su código. */
export const handle = makeInvokeHandler<IpcInvokeContract>({
  withCode: true,
  errorCode: (err) => (err instanceof IpcError ? err.code : undefined)
})

/** Envía un evento tipado a un webContents concreto. */
export function sendTo<C extends IpcEventChannel>(wc: WebContents, channel: C, payload: IpcEventContract[C]): void {
  if (!wc.isDestroyed()) wc.send(channel, payload)
}

/** Envía un evento tipado a todas las ventanas. */
export function broadcast<C extends IpcEventChannel>(channel: C, payload: IpcEventContract[C]): void {
  for (const win of BrowserWindow.getAllWindows()) sendTo(win.webContents, channel, payload)
}
