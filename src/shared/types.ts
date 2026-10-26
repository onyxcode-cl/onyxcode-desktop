/** Tipos de dominio compartidos entre main, preload y renderer. */
import type { LangPref } from './i18n'
import { ENGINE_EXPERIMENTS_DEFAULTS } from './engine-experiments'
import type { EngineLimits } from './engine-limits'

export type ModeId = 'chat' | 'code' | 'tasks' | 'routines' | 'gallery'

export type ThemePreference = 'system' | 'light' | 'dark'

export interface ModelRef {
  providerID: string
  modelID: string
}

/** Interruptor por modo (Overdrive = `tasks`). */
export interface ModeFlags {
  chat: boolean
  code: boolean
  tasks: boolean
}

/** Búsqueda diferida de herramientas de conectores (`tool_search` + `mcp_call`): `auto` = el motor decide por tamaño; `off` = todas sueltas. */
export type ToolSearchMode = 'auto' | 'off'

/** Igual que `ModeFlags` pero con `auto`/`off`. Overdrive (`tasks`) queda siempre en `off`. */
export interface ToolSearchFlags {
  chat: ToolSearchMode
  code: ToolSearchMode
  tasks: ToolSearchMode
}

/** Funciones experimentales del motor; ver `engine-experiments.ts`. Cambiarlas exige reiniciar el motor. */
export interface EngineExperiments {
  codeMode: ModeFlags
  backgroundSubagents: ModeFlags
  toolSearch: ToolSearchFlags
  /**
   * «Formularios de conectores» (MCP `elicitation`): el conector puede pedir datos con un formulario. Solo Chat y Code (hay una persona
   * delante); `tasks` existe por forma pero SIEMPRE vale `false` (se normaliza así y nunca llega la variable a Overdrive).
   */
  mcpElicitation: ModeFlags
}

export interface Settings {
  defaultModel: ModelRef
  theme: ThemePreference
  recentFolders: string[]
  /** Instrucciones globales aplicadas a todas las tareas de Tareas (además de las del proyecto). */
  tasksGlobalInstructions: string
  /** Instrucciones personalizadas de la persona para Chat y Code («cómo quiero que me respondas»); tope 4000 caracteres. */
  userInstructions: string
  /** true cuando el asistente de primer uso terminó, se omitió o no hacía falta (todo ya funcionaba). */
  onboarded: boolean
  /** true cuando el usuario reconoció el aviso sobre los términos de OpenCode y las Rutinas; sin él, las rutinas programadas no se ejecutan solas. */
  routinesTermsAcknowledged: boolean
  /** Idioma de la interfaz: `system` sigue al sistema (en-* da inglés, cualquier otro español). */
  language: LangPref
  /** Ruta absoluta del binario de OpenCode elegido por el usuario ('' = detección automática). Solo main la escribe. */
  opencodeBin: string
  /** Buscar versiones nuevas en GitHub (una petición al día como mucho). */
  checkUpdates: boolean
  /**
   * «Aprender de las tareas» (decisión del dueño, 2026-10-07): el agente de Tareas puede PROPONER memoria
   * (hechos sobre el usuario o sus proyectos) al final de un turno. Nunca se guarda nada sin que el usuario
   * apruebe la tarjeta; esto solo decide si el agente puede proponer. `true` por defecto.
   */
  learningEnabled: boolean
  /** Funciones experimentales del motor por modo (Modo código, subagentes en segundo plano). Apagadas por defecto; el celular no las escribe. */
  engineExperiments: EngineExperiments
  /** Límites del Modo código y del shell en segundo plano. Escaso: solo lo que la persona cambió (ausente = defecto); ver `engine-limits.ts`. */
  engineLimits: EngineLimits
  /**
   * «Recordar mis "siempre" entre sesiones»: el motor guarda en disco los permisos que la persona respondió con «Permitir siempre» (por
   * carpeta de proyecto) y los vuelve a aplicar tras reiniciar. Encendido por defecto; campo NUEVO, así que quien tenía un `settings.json`
   * anterior lo recibe encendido al leer (no hace falta migración: no cambia ningún valor ya guardado). Ver `permission-persist.ts`.
   */
  rememberAlways: boolean
  /**
   * «Activar ganchos» (Ajustes › Funciones experimentales › Ganchos): el motor ejecuta los comandos de `userData/hooks/hooks.json` antes o después
   * de las herramientas. APAGADO por defecto (ejecuta comandos de la persona); solo `true` exacto lo enciende. Nunca llega al sandbox de Tareas.
   * Ver `user-hooks.ts`. El celular no lo escribe.
   */
  userHooksEnabled: boolean
  /** Marca de la migración de 1.6.0: los ayudantes en segundo plano pasan a estar encendidos por defecto, también para quien ya tenía guardado «todo apagado». Se hace una sola vez. */
  engineBgMigrated?: boolean
  /**
   * Conectores (servidores MCP) en los que la persona confía en Code: se usan SIN pedir permiso en cada llamada. Los demás preguntan
   * (por defecto, como Claude Code). Vacío por defecto; los internos de la app (`browser`…) son de confianza fija y no figuran aquí.
   * Ver `mcp-permissions.ts`. El celular no lo escribe.
   */
  codeTrustedMcp: string[]
  /**
   * «Modo plan» (bandera EXPERIMENTAL, motor 2C): la tarjeta del plan de Code (`session.plan.listo`) y su pareja de botones. APAGADA por
   * defecto; solo `true` exacto la enciende. Es solo del cliente: la app NO enciende `LAZUNOX_PLAN` en el motor (queda fuera hasta una
   * revisión de seguridad independiente), así que sin esa variable el motor nunca manda el evento. El celular no la escribe.
   */
  modoPlan: boolean
}

export const DEFAULT_MODEL: ModelRef = { providerID: 'opencode-go', modelID: 'deepseek-v4.1-flash' }

export const DEFAULT_SETTINGS: Settings = {
  defaultModel: DEFAULT_MODEL,
  theme: 'system',
  recentFolders: [],
  tasksGlobalInstructions: '',
  userInstructions: '',
  onboarded: false,
  routinesTermsAcknowledged: false,
  language: 'system',
  opencodeBin: '',
  checkUpdates: true,
  learningEnabled: true,
  engineExperiments: ENGINE_EXPERIMENTS_DEFAULTS,
  engineLimits: {},
  rememberAlways: true,
  userHooksEnabled: false,
  codeTrustedMcp: [],
  modoPlan: false
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

/** Origen del binario de OpenCode en uso: variable OPENCODE_BIN, ajuste del usuario, CLI instalado o el incluido en la app. */
export type OpencodeSource = 'env' | 'settings' | 'cli' | 'bundled'

/** Resultado de `app:opencodeInfo`: qué binario de OpenCode se usaría y si encaja con el SDK de la app. */
export interface OpencodeInfo {
  found: boolean
  path: string | null
  /** De dónde sale `path` (null si no se encontró). */
  source: OpencodeSource | null
  /** Salida de `opencode --version` (número de versión), o null si no se pudo leer. */
  version: string | null
  /** Versión del SDK con la que se compiló la app. */
  sdkVersion: string
  /** Misma versión mayor y menor que el SDK (un parche distinto es compatible). */
  compatible: boolean
  /** Hay un motor incluido en la app (solo empaquetada) al que se puede volver. */
  bundledAvailable: boolean
}

/**
 * Resultado de `app:useBundledEngine` (volver al motor incluido): `ok` (ya no hay ruta elegida; falta reiniciar el motor),
 * `unavailable` (esta app no trae motor incluido) o `pinned` (una variable de entorno fija otro motor y la app no puede soltarla).
 */
export type UseBundledEngineResult = { status: 'ok'; info: OpencodeInfo } | { status: 'unavailable' } | { status: 'pinned' }

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
  /** Id de la sesión (Code) o tarea (Tareas), siempre la sesión RAÍZ. */
  id: string
  /** Carpeta del proyecto (Code) o de Tareas; si falta, se asume la ya abierta. */
  directory?: string
  /** Tareas: la tarea vive en el servidor de Control total (no en el sandbox). */
  fullAccess?: boolean
}
