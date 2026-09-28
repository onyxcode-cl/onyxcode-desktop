import type { IpcMain } from 'electron'
import type { OpencodeServer } from '../opencode/server'
import { broadcast, handle } from './handle'

export function registerOpencodeHandlers(ipcMain: IpcMain, server: OpencodeServer): void {
  // Espera a que el sidecar esté listo (o falla con el error de arranque).
  handle(ipcMain, 'opencode:connection', () => server.start())
  handle(ipcMain, 'opencode:status', () => server.getStatus())
  handle(ipcMain, 'opencode:restart', () => server.restart())

  server.on('status', (status) => broadcast('opencode:status', status))
  server.on('connection', (conn) => broadcast('opencode:connection', conn))
}
