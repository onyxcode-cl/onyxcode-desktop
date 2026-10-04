// Cableado del CLI con el motor real (src/engine), el almacén (src/store), los runners e informes.
// Es el único punto de acoplamiento: si cambian las firmas de esos módulos, se adapta AQUÍ.
// Los imports son dinámicos para que `--help`, `doctor` o `power` no carguen todo el motor.
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { deterministicId } from "../core/ids.ts";
import { supervise } from "../core/proc.ts";
import type { AgentRunner, Configuration, Experiment, Limits, PreparedRun, RawRunOutput, RunContext, RunResult, RunnerProbe, Scenario, Task } from "../core/schemas.ts";
import type { FakeScriptInput } from "../runners/fake/script.ts";
import type { Plan } from "../engine/index.ts";
import type { ExperimentSummary, EngineEvent } from "../engine/index.ts";
import type { ClaimsFile } from "../report/types.ts";
import type { Store } from "../store/index.ts";

// ---------- Runner fake con guion por configuración ----------

/** Ajustes de Configuration.settings para runner "fake". */
export interface FakeSettings {
  /** Guion inline (ver src/runners/fake/script.ts) o ruta a un .json relativa a la raíz del banco. */
  script?: FakeScriptInput | string;
  /**
   * Probabilidad (0..1) de que el agente simulado "resuelva" el caso: si sale bien, se aplica el
   * parche de referencia del caso en el workspace. La decisión es determinista por semilla del run.
   * Sin este ajuste, el guion corre tal cual (normalmente el caso queda sin resolver).
   */
  solveRate?: number;
}

const DEFAULT_SCRIPT: FakeScriptInput = {
  seed: 1,
  jitter: 0.1,
  events: [
    { type: "message", name: "plan", text: "leo el código", delayMs: 20 },
    { type: "tool_call", name: "read", read: "README.md", delayMs: 20 },
    { type: "tool_call", name: "edit", delayMs: 20 },
    { type: "message", name: "fin", delayMs: 20 },
  ],
  usage: { input: 10000, output: 1500, cached: 4000, peakContext: 12000 },
};

/**
 * Runner "fake" del banco: despacha cada configuración a un FakeRunner (interfaz antigua, adaptado con
 * adaptLegacyRunner) con el guion de su `settings.script`. Sin modelos ni red.
 */
export class FakeDispatchRunner implements AgentRunner {
  readonly id = "fake";
  readonly #root: string;
  readonly #scenarios: Map<string, Scenario>;
  constructor(root: string, scenarios: readonly Scenario[]) {
    this.#root = root;
    this.#scenarios = new Map(scenarios.map((s) => [s.id, s]));
  }

  async #inner(cfg: Configuration | null, seed: number | null): Promise<AgentRunner> {
    const { FakeRunner } = await import("../runners/fake/runner.ts");
    const { adaptLegacyRunner } = await import("../engine/index.ts");
    const st = (cfg?.settings ?? {}) as FakeSettings;
    let script: FakeScriptInput = DEFAULT_SCRIPT;
    if (typeof st.script === "string") {
      const f = isAbsolute(st.script) ? st.script : resolve(this.#root, st.script);
      script = JSON.parse(readFileSync(f, "utf8")) as FakeScriptInput;
    } else if (st.script) script = st.script;
    return adaptLegacyRunner(new FakeRunner({ script: seed === null ? script : { ...script, seed } }));
  }

  async probe(): Promise<RunnerProbe> {
    return (await this.#inner(null, null)).probe();
  }

  async prepare(ctx: RunContext, cfg: Configuration): Promise<PreparedRun> {
    const inner = await this.#inner(cfg, ctx.seed);
    const p = await inner.prepare(ctx, cfg);
    return { ...p, state: { ...p.state, inner } };
  }

  async run(p: PreparedRun, task: Task, limits: Limits, signal: AbortSignal): Promise<RawRunOutput> {
    const inner = p.state["inner"] as AgentRunner;
    const raw = await inner.run(p, task, limits, signal);
    const rate = ((p.configuration.settings as FakeSettings).solveRate ?? 0);
    if (raw.outcome !== "completed" || rate <= 0) return raw;
    const u = parseInt(deterministicId("solve", p.ctx.seed ?? 0, task.scenarioId, p.configuration.id).slice(0, 8), 16) / 0xffffffff;
    const patch = this.#scenarios.get(task.scenarioId)?.referencePatch ?? null;
    if (u >= rate || patch === null) return raw;
    const r = await supervise({
      cmd: "git",
      args: ["apply", "--whitespace=nowarn", resolve(this.#root, patch)],
      cwd: p.ctx.workspace,
      env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin", HOME: p.ctx.home },
      timeoutMs: 30_000,
      signal,
    });
    if (r.outcome !== "completed" || r.exitCode !== 0) {
      return { ...raw, outcome: "infra_error", error: `el fake no pudo aplicar el parche de referencia: ${r.stderr.slice(0, 200)}` };
    }
    return raw;
  }

  collect(p: PreparedRun, raw: RawRunOutput) {
    return (p.state["inner"] as AgentRunner).collect(p, raw);
  }

  cleanup(p: PreparedRun) {
    return (p.state["inner"] as AgentRunner).cleanup(p);
  }
}

/** Runners disponibles: `fake` siempre; `opencode` y `codex` solo con allowReal (el CLI ya exigió las salvaguardas). */
export async function buildRunners(root: string, scenarios: readonly Scenario[], allowReal: boolean): Promise<Record<string, AgentRunner>> {
  const runners: Record<string, AgentRunner> = { fake: new FakeDispatchRunner(root, scenarios) };
  if (allowReal) {
    const { OpenCodeRunner } = await import("../runners/opencode/index.ts");
    const { CodexRunner } = await import("../runners/codex/index.ts");
    runners["opencode"] = new OpenCodeRunner();
    runners["codex"] = new CodexRunner();
  }
  return runners;
}

// ---------- Motor ----------

export async function planFor(exp: Experiment, configurations: readonly Configuration[]): Promise<Plan> {
  const { planExperiment } = await import("../engine/index.ts");
  return planExperiment(exp, { configurations });
}

export interface RunRequest {
  experiment: Experiment;
  configurations: Configuration[];
  root: string;
  resultsDir: string;
  runBase: string;
  allowReal: boolean;
  signal: AbortSignal;
  onEvent?: (e: EngineEvent) => void;
}

export async function runFor(req: RunRequest): Promise<ExperimentSummary> {
  const { runExperiment, loadScenarios } = await import("../engine/index.ts");
  const scenarios = loadScenarios(req.root, req.experiment.scenarios);
  const runners = await buildRunners(req.root, scenarios, req.allowReal);
  const store: Store = (await import("../store/index.ts")).openStore(req.resultsDir);
  try {
    return await runExperiment(req.experiment, {
      store,
      scenarios,
      configurations: req.configurations,
      runners,
      benchRoot: req.root,
      runBase: req.runBase,
      signal: req.signal,
      ...(req.onEvent ? { onEvent: req.onEvent } : {}),
    });
  } finally {
    store.close();
  }
}

// ---------- Informes ----------

export interface ReportRequest {
  runs: readonly RunResult[];
  outDir: string;
  baselineId?: string;
  alpha?: number;
  seed?: number;
  boot?: number;
  composite?: boolean;
  title?: string;
  inputRef?: string;
}

export interface AnalysisSummary {
  runs: number;
  cases: number;
  configs: number;
  baselineId: string;
  rows: { configId: string; successRate: number | null; tokensMedian: number | null; durationMedianMs: number | null }[];
  /** Veredictos de cada candidata frente a la base (ITT = todos los runs, PP = solo los válidos). */
  comparisons: { candidateId: string; itt: string | null; pp: string | null }[];
  warnings: string[];
}

export interface ReportApi {
  summarize(req: Omit<ReportRequest, "outDir">): AnalysisSummary;
  write(req: ReportRequest): { files: string[] };
  verify(runs: readonly RunResult[], file: ClaimsFile, req: Omit<ReportRequest, "outDir" | "runs">): { ok: boolean; mismatches: string[] };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export async function loadReport(): Promise<ReportApi> {
  const m = await import("../report/index.ts");
  const opts = (r: Omit<ReportRequest, "outDir" | "runs">): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    if (r.baselineId !== undefined) o["baselineId"] = r.baselineId;
    if (r.alpha !== undefined) o["alpha"] = r.alpha;
    if (r.seed !== undefined) o["seed"] = r.seed;
    if (r.boot !== undefined) o["B"] = r.boot;
    if (r.composite !== undefined) o["composite"] = r.composite;
    if (r.title !== undefined) o["title"] = r.title;
    if (r.inputRef !== undefined) o["inputRef"] = r.inputRef;
    return o;
  };
  return {
    summarize(req) {
      const a = m.analyze(req.runs, opts(req));
      return {
        runs: a.data.runs,
        cases: a.data.cases,
        configs: a.data.configs,
        baselineId: a.options.baselineId,
        rows: a.configs.map((c) => {
          const itt = c.itt as unknown as Record<string, unknown>;
          return { configId: c.configId, successRate: num(itt["rate"] ?? itt["successRate"]), tokensMedian: num(c.tokens.median), durationMedianMs: num(c.duration.median) };
        }),
        comparisons: a.comparisons.map((c) => {
          const cmp = c.comparison as unknown as { candidateId: string; itt: { overall?: unknown }; pp: { overall?: unknown } };
          return { candidateId: cmp.candidateId, itt: str(cmp.itt.overall), pp: str(cmp.pp.overall) };
        }),
        warnings: a.warnings,
      };
    },
    write: (req) => m.writeReport(req.runs, req.outDir, opts(req)),
    verify: (runs, file, req) => m.verifyClaims(runs, file, opts(req)),
  };
}
