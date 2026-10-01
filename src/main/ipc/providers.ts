import { app, net, type IpcMain } from 'electron'
import type { OpencodeServer } from '../opencode/server'
import { KeyProbeBusyError, KeyProber, resolveE2eKeyProbeBase, type ProviderApiMeta } from '../providers/key-probe'
import { handle, IpcError } from './handle'

/** `api.url`/`api.npm` del primer modelo del proveedor según el catálogo del propio motor (loopback, con su auth). */
async function providerApiMeta(server: OpencodeServer, providerID: string): Promise<ProviderApiMeta | null> {
  const conn = server.getConnection()
  if (!conn) return null
  const res = await fetch(`${conn.baseUrl}/provider`, { headers: { authorization: conn.authorization }, signal: AbortSignal.timeout(5000) })
  if (!res.ok) return null
  const body = (await res.json()) as { all?: { id?: string; models?: Record<string, { api?: { url?: string; npm?: string } }> }[] }
  const provider = body.all?.find((p) => p.id === providerID)
  const api = Object.values(provider?.models ?? {})[0]?.api
  return typeof api?.url === 'string' && typeof api.npm === 'string' ? { url: api.url, npm: api.npm } : null
}

/** «Probar clave» (ver `providers/key-probe.ts`): la clave se lee y se usa solo en main. */
export function registerProviderHandlers(ipcMain: IpcMain, server: OpencodeServer): void {
  const baseOverride = resolveE2eKeyProbeBase({ isPackaged: app.isPackaged, env: process.env })
  const prober = new KeyProber({
    userData: app.getPath('userData'),
    // net.fetch: pila de red de Chromium (proxy del sistema); la CSP del renderer no deja salir a internet.
    fetch: (url, init) => net.fetch(url, init),
    isOnline: () => net.isOnline(),
    now: () => Date.now(),
    providerMeta: (id) => providerApiMeta(server, id),
    baseOverride,
    // Con el servidor de pruebas local no hace falta esperar entre intentos.
    minIntervalMs: baseOverride ? 0 : undefined
  })
  handle(ipcMain, 'app:testProviderKey', async ({ providerID }) => {
    try {
      return await prober.test(providerID)
    } catch (err) {
      if (err instanceof KeyProbeBusyError) throw new IpcError('BUSY', err.message)
      throw new IpcError('ERROR', 'No se pudo probar la clave.')
    }
  })
}
