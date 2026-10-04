import type { Capabilities } from "../../core/schemas.ts";

export interface CodexUsage {
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_output_tokens: number | null;
}

export interface CodexItem {
  id: string | null;
  type: string; // agent_message | reasoning | command_execution | file_change | mcp_tool_call | web_search | todo_list | error | ...
  command?: string;
  exitCode?: number | null;
  changes?: Array<{ path: string; kind: string }>;
  text?: string;
}

export interface CodexParsed {
  threadId: string | null;
  turnsStarted: number;
  turnsCompleted: number;
  /** suma de turn.completed.usage; null si ninguno trajo usage */
  usage: CodexUsage | null;
  items: CodexItem[];
  errors: string[];
  failedMessage: string | null;
  unknownEventTypes: Record<string, number>;
  malformedLines: number;
}

export interface RolloutTokens {
  /** token_count distintos (deduplicados por total_token_usage) */
  distinctCalls: number;
  rawEvents: number;
  duplicatesDropped: number;
  peakContext: number | null;
  lastTotal: CodexUsage | null;
  files: number;
}

export type CodexVerdict = "completed" | "agent_error" | "timeout" | "hung" | "rate_limited" | "infra_error" | "cancelled";

export interface CodexRaw {
  verdict: CodexVerdict;
  stopReason: "exit_0" | "exit_nonzero" | "turn_failed" | "rate_limit" | "inactivity" | "timeout" | "cancelled" | "max_steps" | "spawn_error";
  parsed: CodexParsed;
  rollout: RolloutTokens | null;
  stderrTail: string;
  exitCode: number | null;
  orphans: number[];
  /** huérfanos reparentados a init encontrados por cwd bajo runRoot y eliminados */
  swept: number[];
  unverified: string[];
}

export const CODEX_CAPABILITIES: Capabilities = {
  tokens: true,
  cachedTokens: true,
  reasoningTokens: true,
  cost: false, // Codex no informa coste
  llmCalls: true, // vía rollout (si existe); si no, null
  peakContext: true, // vía rollout (si existe); si no, null
  toolCalls: true,
  commands: true,
  fileAccessLists: true, // modified/created/deleted; filesRead queda null (no observable)
  steps: false,
  streaming: true,
  cancel: false, // sin API de abortar: se mata el árbol
};

export interface CodexSettings {
  bin?: { cmd: string; args?: string[] };
  /** model_reasoning_effort (-c) */
  reasoningEffort?: string;
  /** archivos a escribir en CODEX_HOME: ruta relativa -> contenido */
  homeFiles?: Record<string, string>;
  /** sandbox (def workspace-write) */
  sandbox?: "read-only" | "workspace-write";
}
