/**
 * Contrato IPC tipado entre main y renderer.
 *
 * - `IpcInvokeContract`: canales request/response (renderer → main, `ipcRenderer.invoke`).
 * - `IpcEventContract`: eventos push (main → renderer, `webContents.send`).
 *
 * Para agregar un canal: añadir la entrada aquí, registrarlo en `src/main/ipc/<modulo>.ts`
 * con `handle(...)` y usarlo en el renderer con `api.invoke('<canal>', req)`.
 */
import type { AppInfo, NotifyTarget, OpencodeConnection, OpencodeInfo, PickOpencodeBinResult, ServerStatus, Settings } from './types'
import type { OpencodeAction } from './opencode-links'
import type { UpdateState } from './update-check'
import type { AccountState } from './account'

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
   * Notificación nativa desde main (Code/Tareas: sesión terminó o pide algo). `target`, si viene,
   * es adónde llevar al usuario al hacer clic (evento `app:openTarget`).
   */
  'app:notify': { req: { title: string; body: string; target?: NotifyTarget }; res: void }
  /** Badge del Dock (`app.dock.setBadge`); `count === 0` lo limpia. */
  'app:setAttention': { req: { count: number }; res: void }

  /** Binario de OpenCode detectado (ejecuta `--version` en main). */
  'app:opencodeInfo': { req: void; res: OpencodeInfo }
  /** Acciones fijas del asistente: copiar el comando de instalación o abrir una página de OpenCode (lista blanca). */
  'app:opencodeAction': { req: { action: OpencodeAction }; res: void }
  /** Diálogo «Elegir binario…»: valida el archivo y lo guarda en `settings.opencodeBin`. */
  'app:pickOpencodeBin': { req: void; res: PickOpencodeBinResult }
  /** Estado del aviso de versión nueva (la versión publicada se consulta como mucho una vez al día). */
  'app:updateState': { req: void; res: UpdateState }
  /** «Buscar ahora»: fuerza una comprobación (respeta la espera por límite de GitHub). */
  'app:checkUpdates': { req: void; res: UpdateState }
  /** «Más tarde»: no vuelve a avisar de esa versión (sí de una mayor). */
  'app:dismissUpdate': { req: { version: string }; res: UpdateState }
  /** El renderer de la ventana principal ya pintó: con la carga de la ventana completa el marcador de arranque del actualizador. */
  'app:bootConfirm': { req: void; res: void }

  // cuenta (solo ventana principal; ver main/account y docs/CUENTAS-SERVIDOR.md)
  'account:state': { req: void; res: AccountState }
  /** Inicia sesión con Google (navegador + receptor loopback). Resuelve al terminar o cancelar. */
  'account:google': { req: void; res: AccountState }
  /** «Cancelar» mientras se espera al navegador. */
  'account:cancel': { req: void; res: AccountState }
  /** «Reintentar»: vuelve a validar la sesión guardada con el servidor. */
  'account:retry': { req: void; res: AccountState }
  /** Pide un código de 6 dígitos por correo (respuesta uniforme: no revela si la cuenta existe). */
  'account:emailStart': { req: { email: string }; res: void }
  'account:emailVerify': { req: { email: string; code: string }; res: AccountState }
  'account:signOut': { req: void; res: AccountState }
  /** Borra la cuenta en el servidor y la sesión local (no toca las claves de IA ni las conversaciones). */
  'account:delete': { req: void; res: AccountState }
  /** «Descargar mis datos»: guarda el JSON de la cuenta con un diálogo «Guardar como…». */
  'account:export': { req: void; res: { saved: boolean } }

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
  /** Cambio en el estado del aviso de versión nueva (mismo nombre que el invoke, como `opencode:status`). */
  'app:updateState': UpdateState
  /** Cambio en el estado de la cuenta (nunca incluye el token). */
  'account:changed': AccountState
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
  'app:opencodeInfo',
  'app:opencodeAction',
  'app:pickOpencodeBin',
  'app:updateState',
  'app:checkUpdates',
  'app:dismissUpdate',
  'app:bootConfirm',
  'account:state',
  'account:google',
  'account:cancel',
  'account:retry',
  'account:emailStart',
  'account:emailVerify',
  'account:signOut',
  'account:delete',
  'account:export',
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
  'app:openTarget',
  'app:updateState',
  'account:changed'
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
  tasks: import('./ipc-tasks').TasksApi
  extras: import('./ipc-extras').ExtrasApi
  browser: import('./ipc-browser').BrowserApi
}
