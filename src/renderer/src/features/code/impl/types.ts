/**
 * Tipos locales del modo Code.
 *
 * `CodeApi` describe lo que la UI espera del proceso principal. Si el preload expone
 * `window.api.code` con esta forma se usa directamente; si no, `client.ts` lo construye
 * sobre los canales IPC genéricos (`dialog:openFolder`, `git:*`, `pty:*`).
 */
import type { GitStatus, PtyDataEvent, PtyExitEvent, PtyInfo } from '@shared/types'
import type { Part, Message, PermissionRequest, QuestionInfo, Todo } from '@opencode-ai/sdk/v2/client'

export type { GitStatus, PtyInfo }

export interface CodeApi {
  /** Diálogo nativo de carpeta. `null` si se cancela. */
  openFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>
  gitStatus(cwd: string): Promise<GitStatus>
  /** Diff unificado (texto de `git diff`). Sin `path` = todo el repo. */
  gitDiff(req: { cwd: string; path?: string; staged?: boolean }): Promise<string>
  ptyCreate(req: { cwd: string; cols: number; rows: number; shell?: string }): Promise<PtyInfo>
  ptyWrite(id: string, data: string): Promise<void>
  ptyResize(id: string, cols: number, rows: number): Promise<void>
  ptyKill(id: string): Promise<void>
  /** Devuelven función para desuscribir. */
  onPtyData(listener: (ev: PtyDataEvent) => void): () => void
  onPtyExit(listener: (ev: PtyExitEvent) => void): () => void
}

export type CodeAgent = 'build' | 'plan'

export type RightPanel = 'changes' | 'terminal' | 'files'

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
}

export type { PermissionRequest, Todo }
