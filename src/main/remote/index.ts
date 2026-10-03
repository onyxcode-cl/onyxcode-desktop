/**
 * Cableado real del control remoto con Electron, el motor y las librerías nativas. Solo se carga con `import()`
 * dinámico (ver `loader.ts`) cuando el usuario activa la función: mientras está apagada este módulo (y `ws`,
 * `qrcode`, `node-datachannel`) no se cargan.
 */
import { networkInterfaces } from 'node:os'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { OpencodeConnection } from '@shared/types'
import type { RemotePairRequest, RemoteState } from '@shared/ipc-remote'
import type { AuditInput } from './audit'
import type { ConfirmHost } from './confirm-host'
import type { DevicesStore } from './devices-store'
import type { EventStreamClient } from './events'
import { pickLanIp } from './lan-ip'
import { qrMatrix } from './qr'
import { invokeAs } from '../ipc/handle'
import { subscribeRemote } from '../ipc/event-bus'
import { createEngineHost } from './engine-host'
import { createRemoteSender } from './sender'
import { loadRtc } from './rtc'
import { RemoteService } from './service'
import { LanSignalingServer } from './signaling/lan-server'
import { SidecarBackend } from './whitelist'

export interface RemoteBootDeps {
  devices: DevicesStore
  pwaDir: string
  chatDirectory: string
  /** Conexión al motor principal (lo arranca si hace falta). */
  startEngine: () => Promise<OpencodeConnection>
  getConnection: () => OpencodeConnection | null
  getRecentFolders: () => string[]
  modelFor: (kind: 'chat' | 'code') => { providerID: string; modelID: string } | undefined
  onChanged: (state: RemoteState) => void
  onPairRequest: (req: RemotePairRequest) => void
  /** Confirmaciones en el Mac (conexión nueva y acciones «D»). */
  confirmHost: ConfirmHost
  /** Auditoría sin secretos. */
  audit: (e: AuditInput) => void
}

export function createRemote(d: RemoteBootDeps): RemoteService {
  // Un cliente por conexión (el sidecar puede reiniciarse con otro puerto/contraseña).
  let cached: { key: string; client: OpencodeClient } | null = null
  const clientFor = (conn: OpencodeConnection): OpencodeClient => {
    const key = `${conn.baseUrl}|${conn.authorization}`
    if (cached?.key !== key) {
      cached = { key, client: createOpencodeClient({ baseUrl: conn.baseUrl, headers: { Authorization: conn.authorization } }) }
    }
    return cached.client
  }
  const backend = new SidecarBackend({
    getClient: async () => clientFor(await d.startEngine()),
    chatDirectory: d.chatDirectory,
    getRecentFolders: d.getRecentFolders,
    modelFor: d.modelFor
  })
  // Carpetas del ámbito: recientes de Code + carpetas de Tareas aprobadas (se leen por el mismo IPC que usa la ventana).
  const sysSender = createRemoteSender(() => undefined)
  const loadScope = async (): Promise<{ allowedDirs: string[]; chatDirs: string[]; fullAccessDirs: string[] }> => {
    const res = await invokeAs({ sender: sysSender, authorize: () => true }, 'tasks:listFolders', [])
    const folders = res.ok && Array.isArray(res.data) ? (res.data as Array<{ path: string; fullAccess?: boolean }>) : []
    return {
      allowedDirs: [...d.getRecentFolders(), ...folders.map((f) => f.path)],
      chatDirs: [d.chatDirectory],
      fullAccessDirs: folders.filter((f) => f.fullAccess === true).map((f) => f.path)
    }
  }
  const engine = createEngineHost({
    getMain: () => d.startEngine(),
    loadScope,
    invoke: invokeAs,
    open: async (_eng, target, signal) => {
      const client = createOpencodeClient({ baseUrl: target.baseUrl, headers: { Authorization: target.authorization } })
      const r = await client.global.event({ signal, sseMaxRetryAttempts: 1 })
      return r.stream as AsyncIterable<unknown>
    },
    subscribeBus: subscribeRemote,
    confirm: d.confirmHost.queue
  })
  return new RemoteService({
    engine,
    devices: d.devices,
    loadRtc,
    getLanIp: () => pickLanIp(networkInterfaces()),
    createTransport: (ip) =>
      new LanSignalingServer({
        ip,
        pwaDir: d.pwaDir,
        preferredPort: d.devices.getPort(),
        onFirstPort: (port) => d.devices.setPort(port)
      }),
    backend,
    getEventClient: () => {
      const conn = d.getConnection()
      return conn ? (clientFor(conn) as unknown as EventStreamClient) : null
    },
    qr: qrMatrix,
    onChanged: d.onChanged,
    onPairRequest: d.onPairRequest,
    confirmHost: d.confirmHost,
    audit: d.audit
  })
}
