/**
 * Cableado real del control remoto con Electron, el motor y las librerías nativas. Solo se carga con `import()`
 * dinámico (ver `loader.ts`) cuando el usuario activa la función: mientras está apagada este módulo (y `ws`,
 * `qrcode`, `node-datachannel`) no se cargan.
 */
import { networkInterfaces } from 'node:os'
import { app, net, powerMonitor } from 'electron'
import { join } from 'node:path'
import { createOpencodeClient, type OpencodeClient } from '@opencode-ai/sdk/v2/client'
import type { OpencodeConnection } from '@shared/types'
import type { RemotePairRequest, RemotePolicyView, RemoteState } from '@shared/ipc-remote'
import type { RemoteCap } from '@shared/remote/protocol'
import type { EnableApproveInfo } from './approve-setting'
import type { AuditInput } from './audit'
import type { ConfirmHost } from './confirm-host'
import type { DevicesStore } from './devices-store'
import type { EventStreamClient } from './events'
import { pickLanIp } from './lan-ip'
import { qrMatrix } from './qr'
import { loadEntryInfo, type EntryInfo } from './entry-info'
import { SiteWatch } from './site-watch'
import { SITE_KEY_ID, SITE_PUBLIC_KEY } from '@shared/brand'
import { invokeAs } from '../ipc/handle'
import { subscribeRemote } from '../ipc/event-bus'
import { createEngineHost } from './engine-host'
import { createRemoteSender } from './sender'
import { loadRtc } from './rtc'
import { RemoteService } from './service'
import { LanSignalingServer } from './signaling/lan-server'
import { CloudSignalingTransport } from './signaling/worker-client'
import { TunnelSignalingTransport } from './signaling/tunnel-transport'
import { BinaryError, CloudflaredBinary } from './tunnel/binary'
import { CLOUDFLARED_PIN } from './tunnel/pin'
import { realCloudflaredDeps } from './tunnel/real-deps'
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
  /** Diálogo propio del Mac para encender «Aprobar comandos desde este celular». */
  confirmEnableApprove?: (info: EnableApproveInfo) => Promise<boolean>
  /** Política de la organización vigente (se relee en caliente). */
  policy: () => RemotePolicyView
  /** Vigilancia del sitio: `true` = el modo nube está en pausa. */
  cloudPaused?: () => boolean
  siteCheck?: () => 'ok' | 'mismatch' | 'unknown'
  /** Capacidades que el Mac anuncia a un celular v4. */
  caps?: () => RemoteCap[]
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
    confirm: d.confirmHost.queue,
    audit: d.audit,
    // Se lee del almacén en cada decisión: apagarlo (Ajustes, «Cortar todo») surte efecto al instante.
    canApproveCommands: (id) => d.devices.canApproveCommands(id)
  })
  // Vigilancia del sitio firmado (solo con el modo nube en marcha). Un cambio cierra o reabre el enlace con el servicio.
  let svcRef: RemoteService | null = null
  const watch = new SiteWatch({
    publicKey: SITE_PUBLIC_KEY,
    keyId: SITE_KEY_ID,
    fetch: (url, init) => fetch(url, init),
    getMinSeq: () => d.devices.getSiteSeq(),
    setMinSeq: (n) => d.devices.setSiteSeq(n),
    audit: (e) => d.audit(e),
    onChange: () => svcRef?.onSiteChange()
  })
  const sitePaused = (): boolean => watch.paused() || (d.cloudPaused?.() ?? false)
  let entryInfo: EntryInfo | null | undefined
  const entry = (): EntryInfo | null => {
    entryInfo ??= loadEntryInfo(join(d.pwaDir, 'app'), app.getVersion())
    return entryInfo
  }
  // Modo viaje: `cloudflared` se descarga bajo demanda (con consentimiento) y se verifica con el pin compilado en la app.
  const binary = new CloudflaredBinary({
    pin: CLOUDFLARED_PIN,
    binDir: join(app.getPath('userData'), 'bin'),
    // `net.fetch` de Electron respeta el proxy del sistema; las redirecciones las comprueba el propio instalador (lista cerrada de hosts).
    fetch: (url, init) => net.fetch(url, init),
    allowDownload: () => {
      const p = d.policy()
      return p.allowTravelMode && p.allowTravelDownload && !p.blocked
    },
    audit: d.audit
  })
  const svc = new RemoteService({
    engine,
    devices: d.devices,
    loadRtc,
    getLanIp: () => pickLanIp(networkInterfaces()),
    createTransport: (ip, mode) =>
      mode === 'travel'
        ? new TunnelSignalingTransport({
            pwaDir: d.pwaDir,
            // Hash y firma del binario ANTES de cada arranque.
            ensureBinary: () => binary.ensureReady(),
            homeDir: join(app.getPath('userData'), 'cloudflared', 'home'),
            deps: realCloudflaredDeps,
            allowed: () => {
              const p = d.policy()
              return !p.blocked && p.allowTravelMode
            },
            audit: d.audit
          })
        : mode === 'cloud'
          ? new CloudSignalingTransport({
              hostToken: () => d.devices.hostToken(),
              // Sin permiso de la política (o con el sitio en pausa) no se crea ningún socket saliente.
              allowed: () => {
                const p = d.policy()
                return !p.blocked && p.allowOutsideNetwork && !p.requirePasskey && !sitePaused()
              }
            })
          : new LanSignalingServer({
              ip,
              pwaDir: d.pwaDir,
              preferredPort: d.devices.getPort(),
              onFirstPort: (port) => d.devices.setPort(port)
            }),
    travel: {
      binaryState: () => binary.quickState(),
      install: async () => {
        try {
          await binary.install({ consent: true })
          return { ok: true }
        } catch (err) {
          return { ok: false, error: err instanceof BinaryError ? err.code : 'download' }
        }
      },
      verify: () => binary.verifyInstalled()
    },
    backend,
    getEventClient: () => {
      const conn = d.getConnection()
      return conn ? (clientFor(conn) as unknown as EventStreamClient) : null
    },
    qr: qrMatrix,
    onChanged: d.onChanged,
    onPairRequest: d.onPairRequest,
    confirmHost: d.confirmHost,
    audit: d.audit,
    confirmEnableApprove: d.confirmEnableApprove,
    policy: d.policy,
    cloudPaused: sitePaused,
    siteCheck: () => d.siteCheck?.() ?? (SITE_PUBLIC_KEY ? watch.state() : 'unknown'),
    siteWatch: watch,
    // `entry`: archivos de arranque de la interfaz completa con su SRI (solo modo nube). Se calcula una vez, al primer uso.
    caps: () => d.caps?.() ?? (entry() ? ['entry'] : []),
    entry
  })
  svcRef = svc
  watchPowerAndNetwork(svc)
  return svc
}

/**
 * Dormir cierra el socket saliente al instante (el servicio se entera enseguida y no ofrece un Mac que no contesta); despertar,
 * desbloquear la pantalla o cambiar de red lo reabre ya. Solo hace algo con el modo nube en marcha.
 */
function watchPowerAndNetwork(svc: RemoteService): void {
  powerMonitor.on('suspend', () => svc.onPower(true))
  powerMonitor.on('resume', () => svc.onPower(false))
  powerMonitor.on('unlock-screen', () => svc.onPower(false))
  let sig = networkSignature()
  setInterval(() => {
    if (!svc.isCloudRunning()) return
    const now = networkSignature()
    if (now !== sig) {
      sig = now
      svc.onNetworkChange()
    }
  }, 15_000).unref()
}

/** Direcciones externas de las interfaces activas: si cambian, hubo un cambio de red. */
function networkSignature(): string {
  const out: string[] = []
  for (const [name, list] of Object.entries(networkInterfaces()))
    for (const a of list ?? []) if (!a.internal && !a.address.startsWith('fe80')) out.push(`${name}:${a.address}`)
  return out.sort().join('|')
}
