import { z } from "zod";

export const SCHEMA_VERSION = "1" as const;
const sv = z.literal(SCHEMA_VERSION);

/** Número desconocido = null, nunca 0. */
const nnum = z.number().nullable();
const nint = z.number().int().nullable();

export const OutcomeSchema = z.enum([
  "completed",
  "agent_error",
  "timeout",
  "hung",
  "rate_limited",
  "infra_error",
  "cancelled",
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

export const DifficultySchema = z.enum(["L1", "L2", "L3", "L4", "L5", "ctx"]);
export type Difficulty = z.infer<typeof DifficultySchema>;

export const EvaluatorKindSchema = z.enum([
  "tests-visible",
  "tests-hidden",
  "build",
  "typecheck",
  "git_diff",
  "restrictions",
  "anti-cheat",
  "trace_rules",
  "fs_diff",
  "canary",
  "escalation",
  "lang",
  "plan_order",
]);
export type EvaluatorKind = z.infer<typeof EvaluatorKindSchema>;

export const EvaluatorSpecSchema = z.object({
  kind: EvaluatorKindSchema,
  /** comando (argv) cuando aplica; se ejecuta con proc.supervise */
  command: z.array(z.string()).optional(),
  timeoutSec: z.number().positive().default(120),
  weight: z.number().nonnegative().default(1),
  /** parámetros específicos del evaluador */
  params: z.record(z.string(), z.unknown()).default({}),
});
export type EvaluatorSpec = z.infer<typeof EvaluatorSpecSchema>;

export const ScenarioSchema = z.object({
  schemaVersion: sv,
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  description: z.string(),
  category: z.string(), // p. ej. "node", "onyx"
  difficulty: DifficultySchema,
  fixture: z.object({
    path: z.string(), // ruta relativa al repo del banco
    commit: z.string().nullable().default(null),
  }),
  task: z.string(),
  constraints: z
    .object({
      allowedPaths: z.array(z.string()).default([]), // globs; vacío = sin restricción
      forbiddenPaths: z.array(z.string()).default([]),
      maxChangedFiles: z.number().int().positive().nullable().default(null),
    })
    .default({ allowedPaths: [], forbiddenPaths: [], maxChangedFiles: null }),
  evaluators: z.array(EvaluatorSpecSchema).min(1),
  hiddenTests: z.string().nullable().default(null), // ruta; inyectados solo tras morir el árbol del agente
  referencePatch: z.string().nullable().default(null),
  cheatPatch: z.string().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const FeatureRefSchema = z.object({
  name: z.string(),
  version: z.string(),
  path: z.string().nullable().default(null),
});
export type FeatureRef = z.infer<typeof FeatureRefSchema>;

export const ConfigurationSchema = z.object({
  schemaVersion: sv,
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  name: z.string(),
  runner: z.string(), // "opencode" | "codex" | "fake" | ...
  provider: z.string().nullable().default(null),
  model: z.string().nullable().default(null),
  skills: z.array(FeatureRefSchema).default([]),
  subagents: z.array(FeatureRefSchema).default([]),
  /** archivos de prompt/agente inyectados (p. ej. agents/chat.md) */
  prompts: z.array(FeatureRefSchema).default([]),
  settings: z.record(z.string(), z.unknown()).default({}), // reasoning, permisos, etc.
  tags: z.array(z.string()).default([]),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;

export const EnvironmentSchema = z.object({
  schemaVersion: sv,
  os: z.string(),
  arch: z.string(),
  nodeVersion: z.string(),
  gitVersion: z.string().nullable(),
  cliVersion: z.string().nullable(), // versión del CLI bajo prueba
  ncpu: z.number().int().positive(),
  totalMemBytes: z.number().int().positive(),
  benchVersion: z.string(),
  isolation: z.enum(["none", "seatbelt", "docker"]).default("none"),
});
export type Environment = z.infer<typeof EnvironmentSchema>;

export const LimitsSchema = z.object({
  timeoutSec: z.number().positive().default(1200), // 20 min
  maxSteps: z.number().int().positive().default(60),
  maxTokens: z.number().int().positive().default(2_000_000),
  inactivitySec: z.number().positive().default(180),
});
export type Limits = z.infer<typeof LimitsSchema>;

export const ExperimentSchema = z.object({
  schemaVersion: sv,
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/),
  description: z.string().default(""),
  scenarios: z.array(z.string()).min(1), // ids
  configurations: z.array(z.string()).min(1),
  repetitions: z.number().int().positive().default(5),
  seed: z.number().int().default(1),
  design: z.enum(["interleaved", "blocked"]).default("interleaved"),
  limits: LimitsSchema.default(LimitsSchema.parse({})),
  budget: z.object({
    maxCost: z.number().nonnegative(), // obligatorio
    maxRuns: z.number().int().positive().nullable().default(null),
    maxWallSec: z.number().positive().nullable().default(null),
  }),
  concurrency: z.number().int().min(1).max(2).default(1),
  alpha: z.number().gt(0).lt(1).default(0.05),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

/** Telemetría: todo opcional => null si el runner no lo declara. */
export const TelemetrySchema = z.object({
  schemaVersion: sv,
  inputTokens: nint,
  outputTokens: nint,
  cachedTokens: nint,
  reasoningTokens: nint,
  totalTokens: nint,
  llmCalls: nint,
  peakContext: nint,
  costUsd: nnum,
  toolCalls: nint,
  commands: nint,
  steps: nint,
  filesRead: z.array(z.string()).nullable(),
  filesModified: z.array(z.string()).nullable(),
  filesCreated: z.array(z.string()).nullable(),
  filesDeleted: z.array(z.string()).nullable(),
  /** campos específicos del runner, sin romper el esquema común */
  extra: z.record(z.string(), z.unknown()).default({}),
});
export type Telemetry = z.infer<typeof TelemetrySchema>;

export const EvaluatorResultSchema = z.object({
  schemaVersion: sv,
  kind: EvaluatorKindSchema,
  passed: z.boolean().nullable(), // null = no ejecutado/indeterminado
  score: z.number().min(0).max(1).nullable(),
  testsPassed: nint,
  testsTotal: nint,
  violations: z.array(z.string()).default([]),
  details: z.string().default(""),
  durationMs: nint,
});
export type EvaluatorResult = z.infer<typeof EvaluatorResultSchema>;

export const RunResultSchema = z.object({
  schemaVersion: sv,
  runId: z.string(),
  experimentId: z.string().nullable(),
  scenarioId: z.string(),
  configurationId: z.string(),
  runner: z.string(),
  provider: z.string().nullable(),
  model: z.string().nullable(),
  cliVersion: z.string().nullable(),
  features: z.object({ skills: z.array(FeatureRefSchema), subagents: z.array(FeatureRefSchema) }),
  repetition: z.number().int().nonnegative(),
  seed: z.number().int().nullable(),
  startedAt: z.string(), // ISO
  finishedAt: z.string(),
  outcome: OutcomeSchema,
  /** éxito = outcome completed Y evaluadores obligatorios pasan; null si no evaluable */
  success: z.boolean().nullable(),
  telemetry: TelemetrySchema,
  durationMs: z.number().int().nonnegative(),
  evaluators: z.array(EvaluatorResultSchema),
  score: z.object({ correctness: nnum, quality: nnum, efficiency: nnum }),
  orphans: z.number().int().nonnegative().nullable(),
  gitDiff: z.string().nullable(),
  error: z.string().nullable().default(null),
  environment: EnvironmentSchema,
});
export type RunResult = z.infer<typeof RunResultSchema>;

/** Capabilities declaradas por un runner; lo no declarado => null en telemetría. */
export const CapabilitiesSchema = z.object({
  tokens: z.boolean(),
  cachedTokens: z.boolean(),
  reasoningTokens: z.boolean(),
  cost: z.boolean(),
  llmCalls: z.boolean(),
  peakContext: z.boolean(),
  toolCalls: z.boolean(),
  commands: z.boolean(),
  fileAccessLists: z.boolean(), // filesRead/Modified/Created/Deleted
  steps: z.boolean(),
  streaming: z.boolean(),
  cancel: z.boolean(),
});
export type Capabilities = z.infer<typeof CapabilitiesSchema>;

export const NO_CAPABILITIES: Capabilities = {
  tokens: false, cachedTokens: false, reasoningTokens: false, cost: false, llmCalls: false,
  peakContext: false, toolCalls: false, commands: false, fileAccessLists: false, steps: false,
  streaming: false, cancel: false,
};

export function emptyTelemetry(): Telemetry {
  return TelemetrySchema.parse({
    schemaVersion: SCHEMA_VERSION,
    inputTokens: null, outputTokens: null, cachedTokens: null, reasoningTokens: null, totalTokens: null,
    llmCalls: null, peakContext: null, costUsd: null, toolCalls: null, commands: null, steps: null,
    filesRead: null, filesModified: null, filesCreated: null, filesDeleted: null,
  });
}

/** Aplica capabilities: pone null todo campo de telemetría no declarado. */
export function maskTelemetry(t: Telemetry, caps: Capabilities): Telemetry {
  const m: Telemetry = { ...t };
  if (!caps.tokens) { m.inputTokens = null; m.outputTokens = null; m.totalTokens = null; }
  if (!caps.cachedTokens) m.cachedTokens = null;
  if (!caps.reasoningTokens) m.reasoningTokens = null;
  if (!caps.cost) m.costUsd = null;
  if (!caps.llmCalls) m.llmCalls = null;
  if (!caps.peakContext) m.peakContext = null;
  if (!caps.toolCalls) m.toolCalls = null;
  if (!caps.commands) m.commands = null;
  if (!caps.steps) m.steps = null;
  if (!caps.fileAccessLists) { m.filesRead = null; m.filesModified = null; m.filesCreated = null; m.filesDeleted = null; }
  return m;
}

// ---- Interfaz AgentRunner (contrato; implementaciones en src/runners) ----

export interface RunnerProbe {
  available: boolean;
  version: string | null;
  capabilities: Capabilities;
  notes?: string;
}

export interface RunContext {
  runId: string;
  runRoot: string; // ~/ab/r/<runId8>
  workspace: string; // runRoot/ws
  home: string; // runRoot/home
  tmp: string; // runRoot/tmp
  out: string; // runRoot/out (artefactos del run, ya redactados)
  env: Record<string, string>; // whitelist ya aplicada
  seed: number | null;
}

export interface PreparedRun {
  ctx: RunContext;
  configuration: Configuration;
  /** estado opaco del runner */
  state: Record<string, unknown>;
}

export interface Task {
  scenarioId: string;
  prompt: string;
}

export interface RawRunOutput {
  outcome: Outcome;
  exitCode: number | null;
  durationMs: number;
  /** rutas relativas a ctx.out */
  artifacts: string[];
  error: string | null;
  /** datos crudos del runner para collect() */
  raw: Record<string, unknown>;
}

export interface Collected {
  telemetry: Telemetry;
  outcome: Outcome;
}

export interface AgentRunner {
  readonly id: string;
  probe(): Promise<RunnerProbe>;
  prepare(ctx: RunContext, cfg: Configuration): Promise<PreparedRun>;
  run(prepared: PreparedRun, task: Task, limits: Limits, signal: AbortSignal): Promise<RawRunOutput>;
  collect(prepared: PreparedRun, raw: RawRunOutput): Promise<Collected>;
  cleanup(prepared: PreparedRun): Promise<{ orphans: number }>;
}
