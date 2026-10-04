// Tipos de runners. Outcome se re-exporta desde src/core/schemas.ts (única fuente).
import type { Outcome } from "../../core/schemas.ts";
import type { SuperviseResult } from "../../core/proc.ts";

export type { Outcome };

export const METRIC_NAMES = [
  "tokensInput",
  "tokensOutput",
  "tokensCached",
  "tokensTotal",
  "llmCalls",
  "toolCalls",
  "peakContext",
  "filesRead",
  "filesModified",
] as const;
export type MetricName = (typeof METRIC_NAMES)[number];

/** Métricas que el runner declara poder medir; lo no declarado sale null. */
export type Capabilities = Record<MetricName, boolean>;

export interface ProbeResult {
  available: boolean;
  version: string | null;
  capabilities: Capabilities;
}

export interface RunnerContext {
  runId: string;
  runRoot: string;
  ws: string;
  home: string;
  tmp: string;
  out: string;
  /** variables extra (pueden incluir secretos) para el proceso del agente */
  env: Record<string, string>;
  /** valores a redactar en todo artefacto */
  secrets: string[];
}

export interface RunnerConfiguration {
  name: string;
  model: string | null;
  settings?: Record<string, unknown>;
}

export interface AgentTask {
  id: string;
  prompt: string;
}

export interface RunLimits {
  timeoutMs: number;
  inactivityMs?: number;
  graceMs?: number;
}

export interface Prepared {
  ctx: RunnerContext;
  cfg: RunnerConfiguration;
  state: Record<string, unknown>;
}

export type RawRun = SuperviseResult;

export interface NormalizedEvent {
  seq: number;
  type: string;
  name: string | null;
}

/** Telemetría normalizada: sin ids, rutas ni marcas de tiempo (comparable entre runs). */
export interface NormalizedTelemetry {
  schemaVersion: "1";
  runner: string;
  model: string | null;
  metrics: Record<MetricName, number | null>;
  events: NormalizedEvent[];
  runnerSpecific: Record<string, unknown>;
}

export interface CollectResult {
  outcome: Outcome;
  telemetry: NormalizedTelemetry;
  /** rutas absolutas de artefactos escritos (bajo ctx.out) */
  artifacts: string[];
}

export interface AgentRunner {
  id: string;
  probe(): Promise<ProbeResult>;
  prepare(ctx: RunnerContext, cfg: RunnerConfiguration): Promise<Prepared>;
  run(prepared: Prepared, task: AgentTask, limits: RunLimits, signal?: AbortSignal): Promise<RawRun>;
  collect(prepared: Prepared, raw: RawRun): Promise<CollectResult>;
  cleanup(prepared: Prepared): Promise<{ orphans: number }>;
}

/** Comportamientos que la suite de contrato pide a cada runner. */
export type ContractBehavior = "ok" | "rate_limit" | "hang" | "crash" | "orphan" | "slow" | "leak_secret";
export interface ContractScenario {
  behavior: ContractBehavior;
  /** para leak_secret: valor que el agente imprimirá */
  secret?: string;
}
export type MakeRunner = (s: ContractScenario) => AgentRunner | Promise<AgentRunner>;
