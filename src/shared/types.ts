/** Tipos de dominio compartidos entre main, preload y renderer. */

export type ModeId = 'chat' | 'code' | 'cowork' | 'routines'

export type ThemePreference = 'system' | 'light' | 'dark'

export interface ModelRef {
  providerID: string
  modelID: string
}

export interface Settings {
  defaultModel: ModelRef
  theme: ThemePreference
  recentFolders: string[]
  /** Instrucciones globales aplicadas a todas las tareas de Cowork (además de las del proyecto). */
  coworkGlobalInstructions: string
}

export const DEFAULT_MODEL: ModelRef = { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: DEFAULT_MODEL,
  theme: 'system',
  recentFolders: [],
  coworkGlobalInstructions: ''
}

export type ServerState = 'stopped' | 'starting' | 'ready' | 'error'

export interface ServerStatus {
  state: ServerState
  /** Número de reinicios automáticos desde que arrancó la app. */
  restarts: number
  error?: string
  version?: string
}

/** Datos para que el renderer cree su cliente SDK. */
export interface OpencodeConnection {
  baseUrl: string
  /** Valor completo del header `Authorization` (Basic ...). */
  authorization: string
  username: string
  /** Directorio de trabajo para el modo Chat (userData/chat-workspace). */
  chatDirectory: string
  version?: string
}

export interface AppInfo {
  name: string
  version: string
  platform: string
  userDataPath: string
  chatDirectory: string
  isDev: boolean
}

/** Agente de OpenCode usado por el modo Chat (definido en src/main/opencode/config.ts). */
export const CHAT_AGENT = 'chat'

// ---- Notificaciones nativas + badge del Dock ----

/** Modo al que pertenece la sesión/tarea que originó una notificación. */
type NotifyMode = 'code' | 'cowork'

/** Dónde abrir al hacer clic en una notificación (o al restaurar desde el Dock). */
export interface NotifyTarget {
  mode: NotifyMode
  /** Id de la sesión (Code) o tarea (Cowork), siempre la sesión RAÍZ. */
  id: string
  /** Carpeta del proyecto (Code) o de Cowork; si falta, se asume la ya abierta. */
  directory?: string
  /** Cowork: la tarea vive en el servidor de Control total (no en el sandbox). */
  fullAccess?: boolean
}
