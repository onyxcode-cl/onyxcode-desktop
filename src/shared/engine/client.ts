/**
 * `EngineClient`: lo ÚNICO que Lazunox conoce del motor de agentes (OpenCode).
 *
 * Interfaz mínima y por casos de uso (docs/PLAN-ENGINE-CLIENT.md §2): los métodos son los que la
 * app usa hoy; las firmas no dependen del SDK ni de rutas HTTP. Quien la implementa (`adapters/`)
 * traduce al motor concreto. Reglas de uso:
 *
 * - Todo método que toca una carpeta acepta `Scope` (`{ directory }`); si falta se usa la
 *   `directory` de la conexión. El motor 1 la exige por llamada (un 404 por carpeta equivocada es
 *   el fallo típico): pásala siempre que el llamador la conozca.
 * - Los métodos rechazan con `EngineError` (nunca con cuerpos crudos del motor); `kind` dice qué pasó.
 * - Los tipos son serializables (JSON plano) y pueden cruzar IPC o la PWA.
 * - Esta interfaz es ESTABLE: los demás paquetes del plan la consumen sin editarla. Si falta un
 *   método, se pide al paquete P0 en lugar de añadirlo desde fuera.
 */
import type { ElicitationAction, ElicitationReplyResult, ElicitationRequest, ElicitationValue } from '../mcp-elicitation'
import type { EngineEventHandler, EngineEventOptions } from './events'
import type {
  AgentInfo,
  CommandInfo,
  CommandInput,
  ConfiguredProviders,
  EngineConfig,
  FileChange,
  FileContent,
  FileNode,
  FindFilesOptions,
  McpStatus,
  MessagesOptions,
  MessageWithParts,
  ModelRef,
  OAuthStart,
  PermissionReply,
  PermissionRequest,
  ProviderAuthMethodInfo,
  ProviderCatalog,
  PromptInput,
  PtyCreateInput,
  PtyInfo,
  QuestionAnswer,
  QuestionRequest,
  Scope,
  Session,
  SessionCreateInput,
  SessionListOptions,
  SessionStatus,
  SessionUpdateInput,
  SessionDiffEntry,
  Todo,
  VcsDiffEntry,
  VcsInfo,
  VcsStatusEntry
} from './types'

/** Motor al que habla el adaptador: `engine1` = OpenCode 1.19 fijado; `engine2` = OpenCode 2.x (aún sin implementar). */
export type EngineKind = 'engine1' | 'engine2'

/** Cómo llegar al motor. Es lo que hoy se pasa como `{ baseUrl, Authorization }` a cada cliente. */
export interface EngineConnection {
  /** URL base del sidecar (`http://127.0.0.1:puerto`). */
  baseUrl: string
  /** Valor completo de la cabecera `Authorization` (`Basic …`), tal como lo entrega `OpencodeConnection`. */
  authorization?: string
  /** Carpeta de trabajo por defecto cuando una llamada no trae `directory`. */
  directory?: string
  /** Cabeceras extra (se mezclan con `Authorization`). */
  headers?: Record<string, string>
  /** `fetch` a usar (pruebas o entornos sin el global). Por defecto el global. */
  fetch?: typeof fetch
  /**
   * Tope por petición en ms (las rutas de `main` lo usan: 4-30 s). NO aplica al stream de eventos,
   * que es de larga duración. Sin valor, sin tope.
   */
  timeoutMs?: number
}

export interface EngineSessions {
  /** Sesiones de la carpeta (o del proyecto con `project`), recientes primero. `GET /session`. */
  list(o?: SessionListOptions): Promise<Session[]>
  get(id: string, o?: Scope): Promise<Session>
  create(i?: SessionCreateInput): Promise<Session>
  /** Renombra, archiva (`archived`) o cambia reglas de permiso. */
  update(id: string, p: SessionUpdateInput, o?: Scope): Promise<Session>
  remove(id: string, o?: Scope): Promise<void>
  children(id: string, o?: Scope): Promise<Session[]>
  /** Estado de las sesiones NO inactivas de la carpeta, por id (una sesión ausente está inactiva). */
  status(o?: Scope): Promise<Record<string, SessionStatus>>
  todos(id: string, o?: Scope): Promise<Todo[]>
  /** Cambios de archivos de la sesión (opcionalmente hasta un mensaje). */
  diff(id: string, o?: Scope & { messageID?: string }): Promise<SessionDiffEntry[]>
  messages(id: string, o?: MessagesOptions): Promise<MessageWithParts[]>
  message(id: string, messageID: string, o?: Scope): Promise<MessageWithParts>
  deleteMessage(id: string, messageID: string, o?: Scope): Promise<void>
  /** Envía un mensaje y vuelve al instante (`prompt_async`); el turno llega por `events`. */
  send(id: string, i: PromptInput, o?: Scope): Promise<void>
  /** Ejecuta un comando personalizado en la sesión. */
  runCommand(id: string, i: CommandInput, o?: Scope): Promise<void>
  abort(id: string, o?: Scope): Promise<void>
  fork(id: string, o?: Scope & { messageID?: string }): Promise<Session>
  /** Deshace desde un mensaje (y opcionalmente una parte). Devuelve la sesión con `revert`. */
  revert(id: string, messageID: string, o?: Scope & { partID?: string }): Promise<Session>
  unrevert(id: string, o?: Scope): Promise<Session>
  /** Compacta la conversación con el modelo dado. */
  summarize(id: string, model: ModelRef, o?: Scope): Promise<void>
}

export interface EnginePermissions {
  list(o?: Scope): Promise<PermissionRequest[]>
  /**
   * Responde un permiso pendiente. `sessionID` no hace falta con el motor 1, pero el motor 2 sí
   * lo exige: pásalo siempre que lo conozcas.
   */
  reply(id: string, reply: PermissionReply, o?: Scope & { sessionID?: string; message?: string }): Promise<void>
}

export interface EngineQuestions {
  list(o?: Scope): Promise<QuestionRequest[]>
  /** `answers[i]` son las etiquetas elegidas para la pregunta `i`. */
  reply(id: string, answers: QuestionAnswer[], o?: Scope): Promise<void>
  reject(id: string, o?: Scope): Promise<void>
}

/**
 * Formularios de conectores (MCP `elicitation`). Rutas del motor propio que el SDK fijado no trae: `GET /mcp/elicitation` y
 * `POST /mcp/elicitation/{id}/reply`. `list` devuelve `[]` si el motor no las tiene; `reply` informa 400/404 en el resultado.
 */
export interface EngineElicitations {
  list(o?: Scope): Promise<ElicitationRequest[]>
  reply(id: string, action: ElicitationAction, content?: Record<string, ElicitationValue>, o?: Scope): Promise<ElicitationReplyResult>
}

export interface EngineEvents {
  /**
   * Abre el stream global de eventos (todas las carpetas) y entrega cada uno ya normalizado. Se
   * reconecta solo con espera creciente (0,5 s … 10 s) mientras no se cancele. Devuelve la función
   * que lo cierra. Una excepción del handler se informa por `onError` y NO corta el stream.
   */
  subscribe(handler: EngineEventHandler, o?: EngineEventOptions): () => void
}

export interface EngineProviders {
  /** Catálogo completo con los conectados (`/provider`). */
  list(o?: Scope): Promise<ProviderCatalog>
  /** Proveedores configurados y sus modelos por defecto (`/config/providers`). */
  configured(o?: Scope): Promise<ConfiguredProviders>
  /** Métodos de autenticación por proveedor. */
  authMethods(o?: Scope): Promise<Record<string, ProviderAuthMethodInfo[]>>
  /** Guarda una clave de API. Tras cambiarla conviene llamar a `refresh()`. */
  setKey(providerID: string, key: string): Promise<void>
  removeKey(providerID: string): Promise<void>
  oauthStart(providerID: string, method: number, inputs?: Record<string, string>): Promise<OAuthStart>
  oauthFinish(providerID: string, method: number, code?: string): Promise<void>
  /** Hace que el motor relea credenciales y config (`global.dispose`). */
  refresh(): Promise<void>
}

export interface EngineMcp {
  status(o?: Scope): Promise<Record<string, McpStatus>>
  connect(name: string, o?: Scope): Promise<void>
  disconnect(name: string, o?: Scope): Promise<void>
  /** Completa el OAuth de un servidor MCP (abre el navegador y espera). */
  authenticate(name: string, o?: Scope): Promise<McpStatus>
}

export interface EngineFiles {
  list(path: string, o?: Scope): Promise<FileNode[]>
  read(path: string, o?: Scope): Promise<FileContent>
  /** Archivos modificados respecto al último commit (`/file/status`). */
  status(o?: Scope): Promise<FileChange[]>
  /** Búsqueda difusa de rutas por nombre. */
  find(query: string, o?: FindFilesOptions): Promise<string[]>
}

export interface EngineVcs {
  info(o?: Scope): Promise<VcsInfo>
  status(o?: Scope): Promise<VcsStatusEntry[]>
  /** Diferencias contra HEAD (`git`) o contra la rama por defecto (`branch`). */
  diff(mode: 'git' | 'branch', o?: Scope): Promise<VcsDiffEntry[]>
}

/**
 * Terminales del MOTOR. La terminal integrada de Lazunox no pasa por aquí (usa `window.api.pty`
 * por IPC con node-pty); esto cubre solo las PTY que el propio motor administra.
 */
export interface EnginePty {
  list(o?: Scope): Promise<PtyInfo[]>
  create(i?: PtyCreateInput): Promise<PtyInfo>
  resize(id: string, cols: number, rows: number, o?: Scope): Promise<void>
  remove(id: string, o?: Scope): Promise<void>
}

export interface EngineConfigApi {
  /** Configuración efectiva de la carpeta. */
  get(o?: Scope): Promise<EngineConfig>
}

export interface EngineAgents {
  list(o?: Scope): Promise<AgentInfo[]>
  /** Comandos personalizados disponibles (`/comando`). */
  commands(o?: Scope): Promise<CommandInfo[]>
}

export interface EngineClient {
  readonly kind: EngineKind
  readonly sessions: EngineSessions
  readonly permissions: EnginePermissions
  readonly questions: EngineQuestions
  readonly elicitations: EngineElicitations
  readonly events: EngineEvents
  readonly providers: EngineProviders
  readonly mcp: EngineMcp
  readonly files: EngineFiles
  readonly vcs: EngineVcs
  readonly pty: EnginePty
  readonly config: EngineConfigApi
  readonly agents: EngineAgents
  /** Sondeo de salud: NUNCA rechaza; `ok: false` si no responde o rechaza las credenciales. */
  health(): Promise<{ ok: boolean; version?: string }>
}
