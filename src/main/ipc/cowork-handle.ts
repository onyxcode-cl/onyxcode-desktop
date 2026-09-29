/**
 * Utilidades compartidas por los módulos de handlers de Cowork: registro tipado de un canal
 * `invoke` (con guard de esquema y envoltorio `IpcResult`) y el contexto que reciben los
 * submódulos (`cowork-*-handlers.ts`).
 */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import type { IpcResult } from '@shared/ipc'
import type {
  CoworkEventChannel,
  CoworkEventContract,
  CoworkInvokeChannel,
  CoworkRequest,
  CoworkResponse
} from '@shared/ipc-cowork'
import type { CoworkManager } from '../cowork/manager'
import type { CoworkProjectsStore } from '../cowork/projects'
import type { KeepAwakeService } from '../cowork/keep-awake'
import type { ComputerService } from '../computer/service'
import type { SchedulerService } from '../scheduler/service'
import { guardInvoke, IpcGuardError } from './guard'

export type CoworkHandler<C extends CoworkInvokeChannel> = (
  req: CoworkRequest<C>,
  event: IpcMainInvokeEvent
) => CoworkResponse<C> | Promise<CoworkResponse<C>>

function handle<C extends CoworkInvokeChannel>(ipcMain: IpcMain, channel: C, fn: CoworkHandler<C>): void {
  ipcMain.removeHandler(channel)
  ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<CoworkResponse<C>>> => {
    try {
      const req = guardInvoke(event, channel, args) as CoworkRequest<C>
      return { ok: true, data: await fn(req, event) }
    } catch (err) {
      if (err instanceof IpcGuardError) return { ok: false, code: err.kind, error: err.message }
      console.error(`[ipc] ${channel}:`, err)
      return { ok: false, code: 'ERROR', error: err instanceof Error ? err.message : String(err) }
    }
  })
}

/** Devuelve un `handle(canal, fn)` ligado a `ipcMain`. */
export function makeCoworkHandle(ipcMain: IpcMain): <C extends CoworkInvokeChannel>(ch: C, fn: CoworkHandler<C>) => void {
  return (ch, fn) => handle(ipcMain, ch, fn)
}

/** Contexto que `cowork-handlers.ts` entrega a cada submódulo de handlers. */
export interface CoworkIpcContext {
  handle: <C extends CoworkInvokeChannel>(ch: C, fn: CoworkHandler<C>) => void
  /** Difunde un evento a todas las ventanas. */
  send: <C extends CoworkEventChannel>(ch: C, payload: CoworkEventContract[C]) => void
  getWindow: () => BrowserWindow | null
  cowork: CoworkManager
  computer: ComputerService
  scheduler: SchedulerService
  projects: CoworkProjectsStore
  keepAwake: KeepAwakeService
}

/** Cada `registerX(ctx)` devuelve esto; `dispose` se espera al apagar. */
export interface CoworkSubmodule {
  dispose?: () => void | Promise<void>
}
