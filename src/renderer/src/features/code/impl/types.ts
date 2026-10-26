/**
 * Tipos locales del modo Code.
 */
import type { ElicitationRequest } from '@shared/mcp-elicitation'
import type { ElementAttachment } from '../../browser/element-context'
import type { Part, Message, PermissionRequest, QuestionInfo, Todo } from '@opencode-ai/sdk/v2/client'

export type CodeAgent = 'build' | 'plan'

export type RightPanel = 'changes' | 'terminal' | 'files' | 'browser'

export interface CodeMessage {
  info: Message
  parts: Part[]
}

export type RunState = 'idle' | 'busy' | 'retry'

/** Solicitud de permiso pendiente (normaliza `permission.asked` y `permission.v2.asked`). */
export interface PendingPermission {
  id: string
  sessionID: string
  /** Tipo de permiso / acción (edit, bash, webfetch, external_directory…). */
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: { messageID: string; callID: string }
  /** 'v1' → client.permission.reply; 'v2' → client.v2.session.permission.reply */
  api: 'v1' | 'v2'
}

export interface PendingQuestion {
  id: string
  sessionID: string
  questions: QuestionInfo[]
  /** Herramienta que originó la pregunta (`callID` enlaza la pregunta del modo plan con su evento `session.plan.listo`). */
  tool?: { messageID?: string; callID?: string }
}

/** Formulario de un conector pendiente (`mcp.elicitation.asked`), ya saneado por `parseElicitationRequest`. */
export type PendingElicitation = ElicitationRequest

export type { PermissionRequest, Todo }

// ---------------------------------------------------------------------------
// Modos de permiso, cola de mensajes y adjuntos (gap analysis vs clientes de escritorio de referencia)
// ---------------------------------------------------------------------------

/**
 * Modo de permisos de la sesión activa. Se traduce a un `PermissionRuleset` (array de
 * `{ permission, pattern, action }`) enviado con `session.update`.
 *  - manual: pregunta por todo (ruleset vacío → el agente usa su comportamiento por defecto de preguntar).
 *  - acceptEdits: permite editar/escribir archivos sin preguntar; el resto pregunta.
 *  - plan: fuerza el agente "plan" (solo lectura); no llama a session.update.
 *  - auto: permite ediciones y comandos "seguros"; pregunta en bash/external_directory/webfetch.
 *  - bypass: permite todo (equivalente a "Bypass permissions" de Claude Code). Requiere advertencia.
 */
export type PermissionMode = 'manual' | 'acceptEdits' | 'plan' | 'auto' | 'bypass'

export interface FileAttachment {
  id: string
  /** Ausente en los adjuntos de siempre (y en los borradores guardados); `'element'` es un elemento del navegador. */
  kind?: 'file'
  name: string
  mime: string
  /** `data:` URL (imágenes pegadas/arrastradas) o `file://` (archivos adjuntados por ruta). */
  url: string
}

/** Adjunto del compositor: un archivo/imagen o un elemento elegido en el navegador integrado (se convierte en partes al enviar). */
export type Attachment = FileAttachment | ElementAttachment

export interface QueuedMessage {
  id: string
  text: string
  /** Rutas `@mencionadas` relativas al proyecto. */
  files: string[]
  attachments: Attachment[]
}
