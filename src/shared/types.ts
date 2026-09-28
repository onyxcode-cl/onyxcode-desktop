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

// ---- Placeholders tipados para módulos futuros ----

export interface PtyCreateRequest {
  cwd: string
  cols: number
  rows: number
  shell?: string
}
export interface PtyInfo {
  id: string
  pid: number
  cwd: string
}
export interface PtyDataEvent {
  id: string
  data: string
}
export interface PtyExitEvent {
  id: string
  exitCode: number
}

export interface GitFileStatus {
  path: string
  index: string
  workingDir: string
}
export interface GitStatus {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
}
export interface GitWorktree {
  path: string
  branch: string | null
  head: string
}

export interface Routine {
  id: string
  name: string
  /** Expresión cron (5 campos). */
  cron: string
  prompt: string
  model: ModelRef
  /** Directorio donde corre la sesión; null = chat workspace. */
  directory: string | null
  enabled: boolean
  lastRunAt?: number
}
export interface RoutineRun {
  routineId: string
  sessionId: string
  startedAt: number
}

/** Agente de OpenCode usado por el modo Chat (definido en src/main/opencode/config.ts). */
export const CHAT_AGENT = 'chat'
