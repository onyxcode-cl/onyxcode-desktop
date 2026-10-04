import type { Capabilities } from "../../core/schemas.ts";

/** Mensaje de OpenCode tal como lo devuelve GET /session/:id/message (o reconstruido desde sqlite). */
export interface OcMessage {
  info: Record<string, unknown>;
  parts: Array<Record<string, unknown>>;
}

export interface OcSessionNode {
  id: string;
  parentId: string | null;
}

export interface OcDiffEntry {
  file: string;
  additions?: number;
  deletions?: number;
  status?: string; // NV: "added" | "modified" | "deleted"
}

export type OcVerdict = "completed" | "agent_error" | "timeout" | "hung" | "rate_limited" | "infra_error" | "cancelled";

export interface OcRetry {
  attempt: number | null;
  message: string | null;
  at: number;
}

/** Contenido de `raw` en RawRunOutput. */
export interface OcRaw {
  verdict: OcVerdict;
  stopReason: "idle" | "session_error" | "max_steps" | "rate_limit" | "inactivity" | "timeout" | "cancelled" | "server_exit" | "no_url";
  sessionId: string | null;
  baseUrl: string | null;
  messages: OcMessage[];
  diff: OcDiffEntry[];
  retries: OcRetry[];
  stepFinishCount: number;
  eventCount: number;
  eventTypes: Record<string, number>;
  errorMessage: string | null;
  serverOrphans: number[];
  /** huérfanos reparentados a init (cwd bajo runRoot) encontrados y eliminados */
  sweptOrphans: number[];
  /** campos no confirmados que se observaron/faltaron (ver docs/RUNNERS.md) */
  unverified: string[];
}

export const OPENCODE_CAPABILITIES: Capabilities = {
  tokens: true,
  cachedTokens: true,
  reasoningTokens: true,
  cost: true, // NV: depende de que el proveedor tenga precios; si no, queda null por mensaje
  llmCalls: true,
  peakContext: true,
  toolCalls: true,
  commands: true,
  fileAccessLists: true,
  steps: true,
  streaming: true,
  cancel: true,
};

/** Ajustes aceptados en Configuration.settings para el runner opencode. */
export interface OpenCodeSettings {
  /** binario alternativo (tests con binario simulado) */
  bin?: { cmd: string; args?: string[] };
  /** agente OpenCode a usar (def: el predeterminado del servidor) */
  agent?: string;
  /** tope de pasos del agente (steps); def 60 */
  steps?: number;
  /** archivos a poner en OPENCODE_CONFIG_DIR: ruta relativa -> contenido */
  configFiles?: Record<string, string>;
  /** fusión extra sobre OPENCODE_CONFIG_CONTENT */
  configExtra?: Record<string, unknown>;
  /** reintentos de rate limit observados antes de abortar (def 1) */
  rateLimitRetriesBeforeAbort?: number;
}
