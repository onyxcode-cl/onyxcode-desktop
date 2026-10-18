/**
 * Handlers IPC de Telegram (`telegram:*`, F8-B187). Todos son clase X en `remote/policy.ts`: el celular no los toca.
 * Aquí se arma el servicio real (almacén seguro, `net.fetch`, dirección base fija) y se difunde su estado a las ventanas.
 */
import { app, net, safeStorage, type IpcMain } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { IpcExtrasInvokeContract } from '@shared/ipc-extras'
import { broadcastExtras } from '../extras'
import type { OpencodeServer } from '../opencode/server'
import type { SafeStorageLike } from '../remote/devices-store'
import { KeyboxSafeStorage, makeKeyboxFetcher } from '../remote/keybox-storage'
import { TelegramApi, resolveApiBase } from '../telegram/api'
import { createEngineLink } from '../telegram/engine-link'
import { TelegramService } from '../telegram/service'
import { TelegramStore } from '../telegram/store'
import { makeInvokeHandler } from './handle'

const handle = makeInvokeHandler<IpcExtrasInvokeContract>({ withCode: false })

/**
 * Mismo almacén seguro que ya usa la app para los celulares vinculados: en macOS empaquetado, el auxiliar del Llavero cuya identidad
 * no cambia entre versiones (sin preguntas nuevas tras cada actualización); si falta, `safeStorage` de Electron. Sin cifrado
 * disponible el token NO se guarda (no hay respaldo en texto plano).
 */
function telegramSafeStorage(): SafeStorageLike {
  if (process.platform !== 'darwin' || !app.isPackaged) return safeStorage
  const helper = join(process.resourcesPath, 'keybox', 'lazunox-keybox')
  if (!existsSync(helper)) return safeStorage
  return new KeyboxSafeStorage(makeKeyboxFetcher(helper), safeStorage)
}

let service: TelegramService | null = null

export function telegramService(): TelegramService | null {
  return service
}

export function registerTelegramHandlers(ipcMain: IpcMain, deps: { server: OpencodeServer }): void {
  const store = new TelegramStore(app.getPath('userData'), telegramSafeStorage())
  // Dirección base: SIEMPRE https://api.telegram.org salvo en desarrollo/pruebas (app sin empaquetar) con la variable de entorno de
  // pruebas apuntando a un servidor local. Ningún ajuste, archivo ni mensaje de la ventana puede cambiarla.
  const base = resolveApiBase({ isPackaged: app.isPackaged, env: process.env })
  const svc = new TelegramService({
    store,
    engine: createEngineLink({ getConnection: () => deps.server.start() }),
    makeApi: (token) =>
      new TelegramApi({ token, baseUrl: base, fetch: (url, init) => net.fetch(url as string, init) as Promise<Response> }),
    pollTimeoutSec: base === 'https://api.telegram.org' ? 25 : 2,
    housekeepingMs: 15_000,
    onState: (s) => broadcastExtras('telegram:state-changed', s),
    log: (m) => console.log('[telegram]', m)
  })
  service = svc
  svc.init()

  handle(ipcMain, 'telegram:getState', () => svc.getState())
  handle(ipcMain, 'telegram:setEnabled', ({ enabled }) => svc.setEnabled(enabled))
  handle(ipcMain, 'telegram:saveToken', ({ token }) => svc.saveToken(token))
  handle(ipcMain, 'telegram:startLinking', () => svc.startLinking())
  handle(ipcMain, 'telegram:unlink', () => svc.unlink())
  handle(ipcMain, 'telegram:removeBot', () => svc.removeBot())
  handle(ipcMain, 'telegram:panic', () => svc.panic())
  handle(ipcMain, 'telegram:sendTest', () => svc.sendTest())
}

/** Al salir de la app: detiene el polling y la escucha del motor. */
export function disposeTelegram(): void {
  service?.dispose()
  service = null
}
