import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigurationSchema, ExperimentSchema } from "../../src/core/schemas.ts";
import type { AgentRunner, Configuration, Experiment, PreparedRun, RawRunOutput, RunContext, Task, Limits, Collected } from "../../src/core/schemas.ts";
import { adaptLegacyRunner } from "../../src/engine/legacy.ts";
import { loadScenarios } from "../../src/engine/config.ts";
import { FakeRunner } from "../../src/runners/fake/runner.ts";
import type { FakeScriptInput } from "../../src/runners/fake/script.ts";

export const BENCH_ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const CASES = ["node-l1-002-leap-year", "node-l1-003-slugify", "node-l2-001-cart-total"] as const;

export function tmpDir(prefix = "ab-eng-"): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}
export function rmDir(...ds: string[]): void { for (const d of ds) rmSync(d, { recursive: true, force: true }); }

/** Aplica un parche del caso sobre una copia del fixture y devuelve {archivo: contenido} para el guion del FakeRunner. */
export function patchWrites(caseId: string, which: "referencePatch" | "cheatPatch" | null): Record<string, string> {
  if (which === null) return {};
  const sc = loadScenarios(BENCH_ROOT, [caseId])[0]!;
  const dir = tmpDir("ab-patch-");
  try {
    cpSync(resolve(BENCH_ROOT, sc.fixture.path), dir, { recursive: true });
    const patch = resolve(BENCH_ROOT, sc[which]!);
    execFileSync("git", ["apply", patch], { cwd: dir });
    const files = [...readFileSync(patch, "utf8").matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]!);
    return Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
  } finally { rmDir(dir); }
}

export type PatchKind = "referencePatch" | "cheatPatch" | null;

/**
 * Runner de pruebas: delega en un FakeRunner por escenario (cada uno con el parche que toca).
 * `hook` permite alterar el comportamiento (coste, fallos de prepare, contadores...).
 */
export interface RouterOptions {
  id?: string;
  patch: PatchKind | ((scenarioId: string) => PatchKind);
  base?: Partial<FakeScriptInput>;
  costUsd?: number;
  cost?: boolean;
  onPrepare?: () => void;
  onRun?: (task: Task) => void;
  /** reemplaza el outcome tras collect (p. ej. rate_limited las primeras N veces) */
  outcomeFor?: (n: number) => "rate_limited" | null;
  cleanupOrphans?: number;
}

export function routerRunner(o: RouterOptions): AgentRunner {
  const fakes = new Map<string, AgentRunner>();
  let runs = 0;
  const forScenario = (sid: string): AgentRunner => {
    let f = fakes.get(sid);
    if (!f) {
      const kind = typeof o.patch === "function" ? o.patch(sid) : o.patch;
      const script: FakeScriptInput = {
        seed: 3, jitter: 0.1, model: "fake-model",
        events: [{ type: "message", name: "plan", delayMs: 20 }, { type: "tool_call", name: "read", read: "README.md", delayMs: 20 }, { type: "tool_call", name: "write", delayMs: 20 }],
        usage: { input: 1000, output: 200, cached: 100 },
        patch: { write: patchWrites(sid, kind), delete: [] },
        children: 1,
        ...o.base,
      };
      f = adaptLegacyRunner(new FakeRunner({ script }));
      fakes.set(sid, f);
    }
    return f;
  };
  return {
    id: o.id ?? "fake",
    async probe() {
      const p = await forScenario(CASES[0]).probe();
      return { ...p, capabilities: { ...p.capabilities, cost: o.cost ?? false } };
    },
    async prepare(ctx: RunContext, cfg: Configuration): Promise<PreparedRun> {
      o.onPrepare?.();
      return { ctx, configuration: cfg, state: {} };
    },
    async run(p: PreparedRun, task: Task, limits: Limits, signal: AbortSignal): Promise<RawRunOutput> {
      o.onRun?.(task);
      const inner = forScenario(task.scenarioId);
      p.state.inner = inner;
      p.state.innerPrepared = await inner.prepare(p.ctx, p.configuration);
      const raw = await inner.run(p.state.innerPrepared as PreparedRun, task, limits, signal);
      p.state.n = ++runs;
      return raw;
    },
    async collect(p: PreparedRun, raw: RawRunOutput): Promise<Collected> {
      const inner = p.state.inner as AgentRunner;
      const c = await inner.collect(p.state.innerPrepared as PreparedRun, raw);
      const outcome = o.outcomeFor?.(p.state.n as number) ?? c.outcome;
      return { outcome, telemetry: { ...c.telemetry, costUsd: o.costUsd ?? null } };
    },
    async cleanup(p: PreparedRun) {
      const inner = p.state.inner as AgentRunner | undefined;
      const r = inner ? await inner.cleanup(p.state.innerPrepared as PreparedRun) : { orphans: 0 };
      return { orphans: r.orphans + (o.cleanupOrphans ?? 0) };
    },
  };
}

export function cfg(id: string, runner = "fake", extra: Partial<Configuration> = {}): Configuration {
  return ConfigurationSchema.parse({ schemaVersion: "1", id, name: id, runner, model: "m-" + id, ...extra });
}

export function experiment(over: Record<string, unknown> = {}): Experiment {
  return ExperimentSchema.parse({
    schemaVersion: "1", id: "exp-test", scenarios: [...CASES], configurations: ["cfg-ref", "cfg-cheat"], repetitions: 1, seed: 11,
    limits: { timeoutSec: 30, inactivitySec: 10 }, budget: { maxCost: 0 }, ...over,
  });
}
