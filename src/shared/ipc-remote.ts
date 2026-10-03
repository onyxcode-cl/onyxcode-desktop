/**
 * Contrato IPC del control remoto desde el celular (prototipo, solo red local): canales `remote:*`.
 * Solo la ventana principal los puede invocar. Se registran en `src/main/ipc/remote-handlers.ts` y se
 * exponen en el preload como `window.api.remote` (`src/preload/remote-api.ts`).
 *
 * El protocolo con el celular (WebSocket/DataChannel) NO pasa por aquí: vive en `shared/remote/protocol.ts`.
 */

export type RemoteMode = 'off' | 'pairing' | 'active'

/** Por qué la función no se puede activar en este equipo. */
export type RemoteUnavailableReason = 'platform' | 'no-safe-storage' | 'no-network' | 'no-rtc'

export interface RemoteDeviceInfo {
  id: string
  name: string
  /** ms desde epoch. */
  createdAt: number
  lastSeenAt: number | null
  /** ¿Conectado ahora mismo? (como mucho uno a la vez). */
  connected: boolean
  /** 8 hex del sha256 del deviceId (distingue celulares con el mismo nombre; filtro de la actividad). */
  fingerprint: string
  /** ¿Ya fijó su PIN de 6 dígitos? (nunca se expone el PIN ni su hash). */
  hasPin: boolean
  /** «Recordar 12 h»: ms desde epoch hasta los que vale la confirmación de conexión (`null` = se confirma cada vez). */
  trustUntil: number | null
  /**
   * Estado de acceso de la conexión actual: `awaiting` (esperando tu confirmación), `pin` (falta fijar/verificar el PIN),
   * `locked` (bloqueado por inactividad), `open`. `null` si no está conectado.
   */
  access: 'awaiting' | 'pin' | 'locked' | 'open' | null
}

/** Un suceso de la auditoría (`userData/remote-audit.jsonl`): sin secretos, rutas ni contenido. */
export interface RemoteAuditEntry {
  ts: number
  kind: string
  device?: string
  name?: string
  ch?: string
  cls?: string
  n?: number
}

export interface RemotePairing {
  /** URL del QR: `http://<ip-privada>:<puerto>/#s=<secreto>`. El secreto solo vive en memoria. */
  url: string
  /** Matriz del QR (true = módulo oscuro); el renderer la dibuja como SVG. */
  qr: boolean[][]
  /** ms desde epoch en que caduca el QR. */
  expiresAt: number
}

/** Un celular pide vincularse: el dueño debe confirmar en el escritorio (muestra el mismo código que el celular). */
export interface RemotePairRequest {
  requestId: string
  deviceName: string
  /** Código de 6 dígitos derivado de las huellas DTLS de ambos lados. */
  code: string
}

export interface RemoteState {
  /** `false` = la función no se puede usar aquí (ver `unavailable`). */
  available: boolean
  unavailable?: RemoteUnavailableReason
  mode: RemoteMode
  /** QR vigente (solo en `pairing`). */
  pairing: RemotePairing | null
  /** El QR anterior caducó o se usó y todavía no se generó otro. */
  pairingExpired: boolean
  devices: RemoteDeviceInfo[]
  /** Petición de vinculación pendiente de confirmar. */
  pendingPair: RemotePairRequest | null
  /** ms desde epoch en que el modo se apaga solo por inactividad (`null` = hay un celular conectado o está apagado). */
  idleStopAt: number | null
  /** Error legible del último intento de activar. */
  error: string | null
}

export const REMOTE_OFF_STATE: RemoteState = {
  available: true,
  mode: 'off',
  pairing: null,
  pairingExpired: false,
  devices: [],
  pendingPair: null,
  idleStopAt: null,
  error: null
}

/** Texto legible en los dos idiomas de la interfaz (la cola de confirmación no conoce el idioma del renderer). */
export interface RemoteText {
  es: string
  en: string
}

/**
 * Una acción peligrosa («D») pedida desde el celular: el dueño la aprueba o rechaza en el Mac. La aprobación vale SOLO para
 * esa llamada exacta (`digest` = sha256 del canal + payload canónico). La interfaz (T6) la pinta; el plazo es `expiresAt`.
 */
export interface RemoteConfirmRequest {
  requestId: string
  deviceName: string
  /** 8 hex del sha256 del deviceId: permite distinguir dos celulares con el mismo nombre. */
  deviceFingerprint: string
  /** Canal IPC o ruta del motor pedida (`git:removeWorktree`, `POST /permission/{requestID}/reply`). */
  channel: string
  /** Acción en lenguaje humano. */
  summary: RemoteText
  /** Detalle visible (carpeta, apps, nº de archivos…), una línea por dato. */
  detail: string[]
  /** ms desde epoch. */
  createdAt: number
  /** ms desde epoch en que se rechaza sola (90 s tras mostrarse). */
  expiresAt: number
}

/** Canal ficticio de la confirmación de una conexión nueva (solo ahí se ofrece «Recordar 12 h»). */
export const REMOTE_CONNECT_CHANNEL = 'remote:connect'

export interface RemoteInvokeContract {
  'remote:getState': { req: void; res: RemoteState }
  /** «Activar»: abre el servidor local y genera el primer QR. */
  'remote:start': { req: void; res: RemoteState }
  /** QR nuevo (el anterior deja de valer). Activa el modo si estaba apagado. */
  'remote:newPairing': { req: void; res: RemoteState }
  /** «Cortar todo»: cierra conexiones y servidor y anula el QR. */
  'remote:stop': { req: void; res: RemoteState }
  'remote:confirmPair': { req: { requestId: string; accept: boolean }; res: RemoteState }
  'remote:revoke': { req: { deviceId: string }; res: RemoteState }
  /** Respuesta del dueño a una confirmación (`remote:confirmRequest`). Solo la ventana principal. */
  'remote:confirmAction': { req: { requestId: string; accept: boolean; remember?: boolean }; res: void }
  /** «Recordar 12 h» la confirmación de conexión de un dispositivo (o quitarlo). */
  'remote:setRemember': { req: { deviceId: string; remember: boolean }; res: RemoteState }
  /** Borra el PIN de un dispositivo: tendrá que fijar uno nuevo al conectar. */
  'remote:resetPin': { req: { deviceId: string }; res: RemoteState }
  /** Actividad reciente (más nueva primero), opcionalmente de un dispositivo (huella de 8 hex). */
  'remote:auditList': { req: { device?: string } | void; res: RemoteAuditEntry[] }
}

export interface RemoteEventContract {
  'remote:changed': RemoteState
  'remote:pairRequest': RemotePairRequest
  /** Una acción del celular espera confirmación en el Mac (solo ventana principal). */
  'remote:confirmRequest': RemoteConfirmRequest
  /** La confirmación dejó de estar pendiente (caducó, se canceló o se resolvió en otro sitio): cerrar el diálogo. */
  'remote:confirmDismiss': { requestId: string }
}

export type RemoteInvokeChannel = keyof RemoteInvokeContract
export type RemoteEventChannel = keyof RemoteEventContract
export type RemoteRequest<C extends RemoteInvokeChannel> = RemoteInvokeContract[C]['req']
export type RemoteResponse<C extends RemoteInvokeChannel> = RemoteInvokeContract[C]['res']

export const REMOTE_INVOKE_CHANNELS = [
  'remote:getState',
  'remote:start',
  'remote:newPairing',
  'remote:stop',
  'remote:confirmPair',
  'remote:revoke',
  'remote:confirmAction',
  'remote:setRemember',
  'remote:resetPin',
  'remote:auditList'
] as const satisfies readonly RemoteInvokeChannel[]

export const REMOTE_EVENT_CHANNELS = [
  'remote:changed',
  'remote:pairRequest',
  'remote:confirmRequest',
  'remote:confirmDismiss'
] as const satisfies readonly RemoteEventChannel[]

type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
const _remoteInvokeCoverage: Missing<RemoteInvokeChannel, (typeof REMOTE_INVOKE_CHANNELS)[number]> extends never ? true : never = true
const _remoteEventCoverage: Missing<RemoteEventChannel, (typeof REMOTE_EVENT_CHANNELS)[number]> extends never ? true : never = true
void _remoteInvokeCoverage
void _remoteEventCoverage

/** API expuesta en `window.api.remote`. Todos los métodos lanzan `Error` si main falla. */
export interface RemoteApi {
  invoke<C extends RemoteInvokeChannel>(
    channel: C,
    ...args: RemoteRequest<C> extends void ? [] : [req: RemoteRequest<C>]
  ): Promise<RemoteResponse<C>>
  on<C extends RemoteEventChannel>(channel: C, listener: (payload: RemoteEventContract[C]) => void): () => void
}
