import { emptyTelemetry, NO_CAPABILITIES } from "../core/schemas.ts";
import type {
  AgentRunner, Capabilities, Collected, Configuration, Limits, PreparedRun, RawRunOutput, RunContext, RunnerProbe, Task,
} from "../core/schemas.ts";
import type { AgentRunner as LegacyRunner, Prepared as LegacyPrepared, RawRun as LegacyRaw } from "../runners/base/types.ts";

/**
 * Adaptador para runners con la interfaz local antigua (src/runners/base/types.ts, p. ej. FakeRunner)
 * hacia el contrato de src/core/schemas.ts. Los runners reales ya usan el contrato core.
 */
export function adaptLegacyRunner(legacy: LegacyRunner): AgentRunner {
  return {
    id: legacy.id,
    async probe(): Promise<RunnerProbe> {
      const p = await legacy.probe();
      const c = p.capabilities;
      const caps: Capabilities = {
        ...NO_CAPABILITIES,
        tokens: c.tokensInput && c.tokensOutput, cachedTokens: c.tokensCached, llmCalls: c.llmCalls,
        peakContext: c.peakContext, toolCalls: c.toolCalls, cancel: true,
      };
      return { available: p.available, version: p.version, capabilities: caps };
    },
    async prepare(ctx: RunContext, cfg: Configuration): Promise<PreparedRun> {
      const lp = await legacy.prepare(
        { runId: ctx.runId, runRoot: ctx.runRoot, ws: ctx.workspace, home: ctx.home, tmp: ctx.tmp, out: ctx.out, env: ctx.env, secrets: [] },
        { name: cfg.name, model: cfg.model, settings: cfg.settings },
      );
      return { ctx, configuration: cfg, state: { legacy: lp } };
    },
    async run(p: PreparedRun, task: Task, limits: Limits, signal: AbortSignal): Promise<RawRunOutput> {
      const raw = await legacy.run(
        p.state.legacy as LegacyPrepared,
        { id: task.scenarioId, prompt: task.prompt },
        { timeoutMs: limits.timeoutSec * 1000, inactivityMs: limits.inactivitySec * 1000 },
        signal,
      );
      return {
        // el resultado final lo decide collect(); aquí solo se traduce spawn_error
        outcome: raw.outcome === "spawn_error" ? "infra_error" : raw.outcome,
        exitCode: raw.exitCode,
        durationMs: raw.durationMs,
        artifacts: [],
        error: raw.error ?? null,
        raw: { legacy: raw, pid: raw.pid },
      };
    },
    async collect(p: PreparedRun, raw: RawRunOutput): Promise<Collected> {
      const c = await legacy.collect(p.state.legacy as LegacyPrepared, raw.raw.legacy as LegacyRaw);
      const m = c.telemetry.metrics;
      const t = emptyTelemetry();
      t.inputTokens = m.tokensInput;
      t.outputTokens = m.tokensOutput;
      t.cachedTokens = m.tokensCached;
      t.totalTokens = m.tokensTotal;
      t.llmCalls = m.llmCalls;
      t.toolCalls = m.toolCalls;
      t.peakContext = m.peakContext;
      t.extra = { filesReadCount: m.filesRead, filesModifiedCount: m.filesModified, runnerSpecific: c.telemetry.runnerSpecific, model: c.telemetry.model };
      return { telemetry: t, outcome: c.outcome };
    },
    cleanup: (p: PreparedRun) => legacy.cleanup(p.state.legacy as LegacyPrepared),
  };
}
