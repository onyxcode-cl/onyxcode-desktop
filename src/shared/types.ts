/** Tipos de dominio compartidos entre main, preload y renderer. */

export type ModeId = 'chat' | 'code' | 'tasks' | 'routines'

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
  tasksGlobalInstructions: string
  /** true cuando el asistente de primer uso terminó, se omitió o no hacía falta (todo ya funcionaba). */
  onboarded: boolean
  /** Ruta absoluta del binario de OpenCode elegido por el usuario ('' = detección automática). Solo main la escribe. */
  opencodeBin: string
}

export const DEFAULT_MODEL: ModelRef = { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: DEFAULT_MODEL,
  theme: 'system',
  recentFolders: [],
  tasksGlobalInstructions: '',
  onboarded: false,
  opencodeBin: ''
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

/** Resultado de `app:opencodeInfo`: qué binario de OpenCode se usaría y si encaja con el SDK de la app. */
export interface OpencodeInfo {
  found: boolean
  path: string | null
  /** Salida de `opencode --version` (número de versión), o null si no se pudo leer. */
  version: string | null
  /** Versión del SDK con la que se compiló la app. */
  sdkVersion: string
  /** Misma versión mayor y menor que el SDK (un parche distinto es compatible). */
  compatible: boolean
}

/** Resultado de `app:pickOpencodeBin` (diálogo «Elegir binario…»). */
export type PickOpencodeBinResult = { status: 'canceled' } | { status: 'invalid'; error: string } | { status: 'ok'; info: OpencodeInfo }

/** Agente de OpenCode usado por el modo Chat (definido en src/main/opencode/config.ts). */
export const CHAT_AGENT = 'chat'

// ---- Notificaciones nativas + badge del Dock ----

/** Modo al que pertenece la sesión/tarea que originó una notificación. */
type NotifyMode = 'code' | 'tasks'

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
