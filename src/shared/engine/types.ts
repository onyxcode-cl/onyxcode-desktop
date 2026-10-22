/**
 * Tipos propios del motor que usa el resto de Lazunox (main, renderer y PWA).
 *
 * ETAPA 0 (docs/PLAN-ENGINE-CLIENT.md, paso 0.1): son ALIAS exactos de los tipos del cliente
 * generado `@opencode-ai/sdk/v2/client` (la API 1.19, no el motor 2.x), para que migrar un
 * consumidor sea solo cambiar el import. Son `import type`: se borran al compilar y no meten el
 * SDK en ningún bundle. Este archivo es el ÚNICO de `src/shared/engine/` (además de
 * `adapters/engine1.ts`) que nombra el SDK; cuando se rediseñe un tipo, se sustituye aquí el alias
 * por una definición propia y los consumidores no cambian.
 *
 * Los tipos de entrada (`PromptInput`, `SessionCreateInput`…) ya son propios y NO dependen del SDK.
 */
import type {
  Agent,
  AssistantMessage as SdkAssistantMessage,
  Command as SdkCommand,
  Config as SdkConfig,
  EventSessionError,
  File as SdkFileChange,
  FileContent as SdkFileContent,
  FileNode as SdkFileNode,
  FilePart as SdkFilePart,
  FilePartInput,
  AgentPartInput,
  Message as SdkMessage,
  McpStatus as SdkMcpStatus,
  Part as SdkPart,
  PermissionRequest as SdkPermissionRequest,
  PermissionRule as SdkPermissionRule,
  PermissionRuleset as SdkPermissionRuleset,
  Provider,
  ProviderAuthAuthorization,
  ProviderAuthMethod,
  Pty,
  QuestionAnswer as SdkQuestionAnswer,
  QuestionInfo as SdkQuestionInfo,
  QuestionRequest as SdkQuestionRequest,
  ReasoningPart as SdkReasoningPart,
  Session as SdkSession,
  SessionStatus as SdkSessionStatus,
  SnapshotFileDiff,
  SubtaskPartInput,
  TextPart as SdkTextPart,
  TextPartInput,
  Todo as SdkTodo,
  ToolPart as SdkToolPart,
  UserMessage as SdkUserMessage,
  VcsFileDiff,
  VcsFileStatus,
  VcsInfo as SdkVcsInfo
} from '@opencode-ai/sdk/v2/client'

// ───────────────────────────── sesiones y mensajes ─────────────────────────────

export type Session = SdkSession
export type SessionStatus = SdkSessionStatus
export type Todo = SdkTodo
export type UserMessage = SdkUserMessage
export type AssistantMessage = SdkAssistantMessage
export type Message = SdkMessage
export type Part = SdkPart
export type TextPart = SdkTextPart
export type ReasoningPart = SdkReasoningPart
export type ToolPart = SdkToolPart
export type FilePart = SdkFilePart
/** Un mensaje con sus partes, tal como lo devuelve `sessions.messages`. */
export interface MessageWithParts {
  info: Message
  parts: Part[]
}
/** Cambios de archivos de un turno (`session.diff`). */
export type SessionDiffEntry = SnapshotFileDiff
/** Error de sesión que reporta el motor (`session.error`). */
export type SessionErrorInfo = NonNullable<EventSessionError['properties']['error']>

// ───────────────────────────── permisos y preguntas ─────────────────────────────

export type PermissionRequest = SdkPermissionRequest
export type PermissionRule = SdkPermissionRule
export type PermissionRuleset = SdkPermissionRuleset
/** Respuesta a un permiso: una vez, siempre (se recuerda) o rechazar. */
export type PermissionReply = 'once' | 'always' | 'reject'
export type QuestionRequest = SdkQuestionRequest
export type QuestionInfo = SdkQuestionInfo
/** Respuesta a una pregunta: una lista de etiquetas elegidas por cada pregunta. */
export type QuestionAnswer = SdkQuestionAnswer

// ───────────────────────────── proveedores, MCP, config ─────────────────────────────

export type ProviderInfo = Provider
/** Catálogo completo de proveedores (`/provider`). */
export interface ProviderCatalog {
  /** Todos los proveedores conocidos. */
  all: ProviderInfo[]
  /** Modelo por defecto por proveedor. */
  default: Record<string, string>
  /** Ids de los proveedores con credenciales. */
  connected: string[]
}
/** Proveedores configurados y utilizables (`/config/providers`). */
export interface ConfiguredProviders {
  providers: ProviderInfo[]
  default: Record<string, string>
}
export type ProviderAuthMethodInfo = ProviderAuthMethod
/** Inicio de un flujo OAuth de proveedor: URL a abrir y cómo se completa (`auto` | `code`). */
export type OAuthStart = ProviderAuthAuthorization
export type McpStatus = SdkMcpStatus
export type EngineConfig = SdkConfig
export type AgentInfo = Agent
export type CommandInfo = SdkCommand

// ───────────────────────────── archivos, VCS, PTY ─────────────────────────────

export type FileNode = SdkFileNode
export type FileContent = SdkFileContent
/** Estado de un archivo en el árbol de trabajo (`/file/status`). */
export type FileChange = SdkFileChange
export type VcsInfo = SdkVcsInfo
export type VcsStatusEntry = VcsFileStatus
export type VcsDiffEntry = VcsFileDiff
/** Terminal del motor (no es la terminal integrada de Lazunox, que va por `window.api.pty`). */
export type PtyInfo = Pty

// ───────────────────────────── entradas (propias, sin SDK) ─────────────────────────────

/** Ámbito de una llamada: carpeta de trabajo. Si falta, se usa la `directory` de la conexión. */
export interface Scope {
  directory?: string
}

/** Modelo elegido para un turno. */
export interface ModelRef {
  providerID: string
  modelID: string
}

/** Parte de un mensaje de entrada: texto, archivo adjunto, mención de agente o subtarea. */
export type PromptPartInput = TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput

/** Envío de un mensaje (`prompt_async`: responde al instante y el turno sigue en segundo plano). */
export interface PromptInput {
  parts: PromptPartInput[]
  model?: ModelRef
  agent?: string
  variant?: string
  /** Id propio del mensaje de usuario (para reintentos idempotentes). */
  messageID?: string
  system?: string
  /** No genera respuesta del modelo (solo guarda el mensaje). */
  noReply?: boolean
  tools?: Record<string, boolean>
}

/** Parte de archivo permitida al ejecutar un comando. */
export interface CommandFileInput {
  id?: string
  type: 'file'
  mime: string
  filename?: string
  url: string
}

/** Ejecución de un comando personalizado (`/comando argumentos`). */
export interface CommandInput {
  command: string
  arguments?: string
  agent?: string
  /** Modelo en formato `proveedor/modelo`. */
  model?: string
  variant?: string
  messageID?: string
  parts?: CommandFileInput[]
}

export interface SessionListOptions extends Scope {
  /** Solo sesiones raíz (sin padre). */
  roots?: boolean
  /** Todas las del proyecto, no solo las de esta carpeta. */
  project?: boolean
  /** Filtra por título. */
  search?: string
  /** Solo sesiones actualizadas desde este instante (ms). */
  start?: number
  limit?: number
}

export interface SessionCreateInput extends Scope {
  title?: string
  parentID?: string
  agent?: string
  model?: { id: string; providerID: string; variant?: string }
  metadata?: Record<string, unknown>
  permission?: PermissionRuleset
}

export interface SessionUpdateInput {
  title?: string
  metadata?: Record<string, unknown>
  permission?: PermissionRuleset
  /** Instante de archivado en ms; `0` o `null` la desarchiva. */
  archived?: number | null
}

export interface MessagesOptions extends Scope {
  limit?: number
  /** Id de mensaje: trae los anteriores a él (paginación). */
  before?: string
}

export interface PtyCreateInput extends Scope {
  command?: string
  args?: string[]
  cwd?: string
  title?: string
  env?: Record<string, string>
}

export interface FindFilesOptions extends Scope {
  type?: 'file' | 'directory'
  limit?: number
}
