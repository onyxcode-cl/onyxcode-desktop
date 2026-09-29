/**
 * Contrato IPC tipado entre main y renderer.
 *
 * - `IpcInvokeContract`: canales request/response (renderer → main, `ipcRenderer.invoke`).
 * - `IpcEventContract`: eventos push (main → renderer, `webContents.send`).
 *
 * Para agregar un canal: añadir la entrada aquí, registrarlo en `src/main/ipc/<modulo>.ts`
 * con `handle(...)` y usarlo en el renderer con `api.invoke('<canal>', req)`.
 */
import type { AppInfo, NotifyTarget, OpencodeConnection, ServerStatus, Settings } from './types'

/** FORBIDDEN = emisor/ventana no autorizados; INVALID = payload rechazado por el esquema. */
export type IpcErrorCode = 'NOT_READY' | 'ERROR' | 'FORBIDDEN' | 'INVALID'

/** Respuesta sin código de error (canales `extras:`/`mcp:`/`browser:`). */
export type IpcPlainResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Todas las respuestas IPC vienen envueltas; nunca se lanza a través del puente. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; code: IpcErrorCode; error: string }

export interface IpcInvokeContract {
  // app
  'app:info': { req: void; res: AppInfo }
  'app:openExternal': { req: { url: string }; res: void }
  /**
   * Notificación nativa desde main (Code/Cowork: sesión terminó o pide algo). `target`, si viene,
   * es adónde llevar al usuario al hacer clic (evento `app:openTarget`).
   */
  'app:notify': { req: { title: string; body: string; target?: NotifyTarget }; res: void }
  /** Badge del Dock (`app.dock.setBadge`); `count === 0` lo limpia. */
  'app:setAttention': { req: { count: number }; res: void }

  // opencode sidecar
  'opencode:connection': { req: void; res: OpencodeConnection }
  'opencode:status': { req: void; res: ServerStatus }
  'opencode:restart': { req: void; res: OpencodeConnection }

  // settings
  'settings:get': { req: void; res: Settings }
  'settings:set': { req: Partial<Settings>; res: Settings }
  'settings:addRecentFolder': { req: { path: string }; res: Settings }
}

export interface IpcEventContract {
  'opencode:status': ServerStatus
  'opencode:connection': OpencodeConnection
  'settings:changed': Settings
  /** Clic en una notificación (o "abrir" desde el Dock): el renderer cambia de modo y selecciona. */
  'app:openTarget': NotifyTarget
}

export type IpcInvokeChannel = keyof IpcInvokeContract
export type IpcEventChannel = keyof IpcEventContract
export type IpcRequest<C extends IpcInvokeChannel> = IpcInvokeContract[C]['req']
export type IpcResponse<C extends IpcInvokeChannel> = IpcInvokeContract[C]['res']

/** Lista en runtime de canales permitidos (el preload valida contra esto). */
export const IPC_INVOKE_CHANNELS = [
  'app:info',
  'app:openExternal',
  'app:notify',
  'app:setAttention',
  'opencode:connection',
  'opencode:status',
  'opencode:restart',
  'settings:get',
  'settings:set',
  'settings:addRecentFolder'
] as const satisfies readonly IpcInvokeChannel[]

export const IPC_EVENT_CHANNELS = [
  'opencode:status',
  'opencode:connection',
  'settings:changed',
  'app:openTarget'
] as const satisfies readonly IpcEventChannel[]

// Garantiza en compilación que las listas cubren todo el contrato.
type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
const _invokeCoverage: Missing<IpcInvokeChannel, (typeof IPC_INVOKE_CHANNELS)[number]> extends never ? true : never = true
const _eventCoverage: Missing<IpcEventChannel, (typeof IPC_EVENT_CHANNELS)[number]> extends never ? true : never = true
void _invokeCoverage
void _eventCoverage

/** API expuesta por el preload en `window.api`. */
export interface WindowApi {
  invoke<C extends IpcInvokeChannel>(
    channel: C,
    ...args: IpcRequest<C> extends void ? [] : [req: IpcRequest<C>]
  ): Promise<IpcResult<IpcResponse<C>>>
  /** Suscribe a un evento main → renderer. Devuelve función para desuscribir. */
  on<C extends IpcEventChannel>(channel: C, listener: (payload: IpcEventContract[C]) => void): () => void
  platform: string
  code: import('./ipc-code').CodeApi
  cowork: import('./ipc-cowork').CoworkApi
  extras: import('./ipc-extras').ExtrasApi
  browser: import('./ipc-browser').BrowserApi
}
