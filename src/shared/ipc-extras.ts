/**
 * Contrato IPC de "extras": ajustes propios (atajos, modelos por modo), MCP administrado
 * por la app, Quick Entry, ventana de artifacts y bandeja del sistema.
 *
 * Canales con prefijo `extras:` y `mcp:`. Se registran en `src/main/ipc/extras-handlers.ts`
 * y se exponen en el preload como `window.api.extras` (`src/preload/extras-api.ts`).
 */
import type { ModelRef } from './types'

export type IpcExtrasResult<T> = { ok: true; data: T } | { ok: false; error: string }

/** Modos que usan un modelo (Rutinas elige el suyo por rutina). */
export type ModelMode = 'chat' | 'code' | 'cowork'

export interface ExtrasPrefs {
  /** Acelerador de Electron para Quick Entry (p.ej. "Alt+Space"). Vacío = desactivado. */
  quickEntryShortcut: string
  /** Modelo por modo; si falta, se usa `settings.defaultModel`. */
  modelsByMode: Partial<Record<ModelMode, ModelRef>>
  /** Mostrar icono en la barra de menús. */
  showTray: boolean
  /** Notificaciones nativas (Code/Cowork: sesión terminó o pide algo). */
  notificationsEnabled: boolean
  /** Sonido de las notificaciones (`Notification.silent` invertido). */
  soundEnabled: boolean
}

export const DEFAULT_QUICK_ENTRY_SHORTCUT = 'Alt+Space'

export const DEFAULT_EXTRAS_PREFS: ExtrasPrefs = {
  quickEntryShortcut: DEFAULT_QUICK_ENTRY_SHORTCUT,
  modelsByMode: {},
  showTray: true,
  notificationsEnabled: true,
  soundEnabled: true
}

export interface ExtrasPrefsState {
  prefs: ExtrasPrefs
  /** Error al registrar el atajo global (ocupado por otra app, inválido…). */
  shortcutError: string | null
}

export interface VersionsInfo {
  app: string
  electron: string
  chrome: string
  node: string
  v8: string
  platform: string
  arch: string
  osRelease: string
}

// ---- MCP administrado por la app ----

export interface McpLocalEntry {
  type: 'local'
  /** Comando + argumentos. */
  command: string[]
  environment?: Record<string, string>
  cwd?: string
  enabled?: boolean
  timeout?: number
}

export interface McpRemoteEntry {
  type: 'remote'
  url: string
  headers?: Record<string, string>
  enabled?: boolean
  timeout?: number
  /** `false` desactiva la autodetección OAuth. */
  oauth?: false | Record<string, string | number>
}

export type McpEntry = McpLocalEntry | McpRemoteEntry

export interface AppMcpConfig {
  /** Ruta del archivo JSON propiedad de la app (se pasa al sidecar vía OPENCODE_CONFIG). */
  path: string
  servers: Record<string, McpEntry>
}

export interface ArtifactPayload {
  title: string
  html: string
}

export interface QuickPromptEvent {
  text: string
}

export interface IpcExtrasInvokeContract {
  'extras:getPrefs': { req: void; res: ExtrasPrefsState }
  'extras:setPrefs': { req: Partial<ExtrasPrefs>; res: ExtrasPrefsState }
  'extras:versions': { req: void; res: VersionsInfo }
  'extras:openArtifact': { req: ArtifactPayload; res: void }
  /** Desde la ventana Quick Entry. */
  'extras:quickSubmit': { req: QuickPromptEvent; res: void }
  'extras:quickHide': { req: void; res: void }
  'extras:quickToggle': { req: void; res: void }
  /** Suspende el atajo global mientras se graba uno nuevo en Ajustes. */
  'extras:suspendShortcut': { req: { suspended: boolean }; res: void }
  /** La ventana principal lo llama al montar: prompt de Quick Entry que llegó mientras cargaba. */
  'extras:takePendingPrompt': { req: void; res: QuickPromptEvent | null }
  'mcp:getConfig': { req: void; res: AppMcpConfig }
  'mcp:save': { req: { name: string; entry: McpEntry; previousName?: string }; res: AppMcpConfig }
  'mcp:remove': { req: { name: string }; res: AppMcpConfig }
  'mcp:setEnabled': { req: { name: string; enabled: boolean }; res: AppMcpConfig }
  'mcp:revealConfig': { req: void; res: void }
}

export interface IpcExtrasEventContract {
  /** Main → ventana principal: abrir Chat con este prompt. */
  'extras:quick-prompt': QuickPromptEvent
  /** Main → ventana principal: nueva conversación (bandeja). */
  'extras:new-conversation': void
  /** Main → ventana principal: abrir ajustes. */
  'extras:open-settings': void
  'extras:prefs-changed': ExtrasPrefsState
  /** Main → Quick Entry: la ventana se mostró (enfocar/limpiar input). */
  'extras:quick-shown': void
  /** El archivo MCP de la app cambió. */
  'mcp:changed': AppMcpConfig
}

export type IpcExtrasInvokeChannel = keyof IpcExtrasInvokeContract
export type IpcExtrasEventChannel = keyof IpcExtrasEventContract

export const IPC_EXTRAS_INVOKE_CHANNELS = [
  'extras:getPrefs',
  'extras:setPrefs',
  'extras:versions',
  'extras:openArtifact',
  'extras:quickSubmit',
  'extras:quickHide',
  'extras:quickToggle',
  'extras:suspendShortcut',
  'extras:takePendingPrompt',
  'mcp:getConfig',
  'mcp:save',
  'mcp:remove',
  'mcp:setEnabled',
  'mcp:revealConfig'
] as const satisfies readonly IpcExtrasInvokeChannel[]

export const IPC_EXTRAS_EVENT_CHANNELS = [
  'extras:quick-prompt',
  'extras:new-conversation',
  'extras:open-settings',
  'extras:prefs-changed',
  'extras:quick-shown',
  'mcp:changed'
] as const satisfies readonly IpcExtrasEventChannel[]

type Missing<All extends string, Listed extends string> = Exclude<All, Listed>
const _inv: Missing<IpcExtrasInvokeChannel, (typeof IPC_EXTRAS_INVOKE_CHANNELS)[number]> extends never ? true : never = true
const _ev: Missing<IpcExtrasEventChannel, (typeof IPC_EXTRAS_EVENT_CHANNELS)[number]> extends never ? true : never = true
void _inv
void _ev

type Req<C extends IpcExtrasInvokeChannel> = IpcExtrasInvokeContract[C]['req']
type Res<C extends IpcExtrasInvokeChannel> = IpcExtrasInvokeContract[C]['res']
type Payload<C extends IpcExtrasEventChannel> = IpcExtrasEventContract[C]

/** API expuesta en `window.api.extras`. Todos los métodos lanzan `Error` si main falla. */
export interface ExtrasApi {
  invoke<C extends IpcExtrasInvokeChannel>(channel: C, ...args: Req<C> extends void ? [] : [req: Req<C>]): Promise<Res<C>>
  on<C extends IpcExtrasEventChannel>(
    channel: C,
    listener: Payload<C> extends void ? () => void : (payload: Payload<C>) => void
  ): () => void
  // Atajos de conveniencia
  openArtifact(payload: ArtifactPayload): Promise<void>
  onQuickPrompt(listener: (event: QuickPromptEvent) => void): () => void
  onNewConversation(listener: () => void): () => void
  onOpenSettings(listener: () => void): () => void
}
