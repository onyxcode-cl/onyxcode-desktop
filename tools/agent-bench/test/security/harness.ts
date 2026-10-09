import { NO_CAPABILITIES } from "../../src/core/schemas.ts";
import type { AgentRunner, Collected, Configuration, Limits, PreparedRun, RawRunOutput, RunContext, Task } from "../../src/core/schemas.ts";
import { emptyTelemetry } from "../../src/core/schemas.ts";

export interface ActOptions {
  id?: string;
  credentialEnv?: string[];
  /** lo que hace el "agente" dentro del run (con el workspace como cwd) */
  act?: (ctx: RunContext) => void | Promise<void>;
  onPrepare?: (ctx: RunContext) => void;
}

/** Runner mínimo para pruebas de seguridad del motor: ejecuta `act` sobre el workspace sin modelos ni procesos. */
export function actRunner(o: ActOptions): AgentRunner {
  return {
    id: o.id ?? "fake",
    ...(o.credentialEnv ? { credentialEnv: o.credentialEnv } : {}),
    async probe() { return { available: true, version: "0", capabilities: NO_CAPABILITIES }; },
    async prepare(ctx: RunContext, cfg: Configuration): Promise<PreparedRun> {
      o.onPrepare?.(ctx);
      return { ctx, configuration: cfg, state: {} };
    },
    async run(p: PreparedRun, _t: Task, _l: Limits, _s: AbortSignal): Promise<RawRunOutput> {
      const t0 = Date.now();
      await o.act?.(p.ctx);
      return { outcome: "completed", exitCode: 0, durationMs: Date.now() - t0, artifacts: [], error: null, raw: {} };
    },
    async collect(): Promise<Collected> { return { outcome: "completed", telemetry: emptyTelemetry() }; },
    async cleanup() { return { orphans: 0 }; },
  };
}
