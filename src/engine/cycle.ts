import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newRunId } from "../core/ids.ts";
import { verifyNoOrphans } from "../core/proc.ts";
import { containsSecret, redactText } from "../core/redact.ts";
import { emptyTelemetry, maskTelemetry, RunResultSchema, SCHEMA_VERSION } from "../core/schemas.ts";
import type {
  AgentRunner, Capabilities, Configuration, Environment, Experiment, Outcome, RunContext, RunResult, Scenario, Telemetry,
} from "../core/schemas.ts";
import { buildEnv, createRunLayout, removeRunLayout } from "../isolation/index.ts";
import type { RunLayout } from "../isolation/index.ts";
import { captureDiff, createEvalCopy, createWorkspace, TreeDeadSignal } from "../workspace/index.ts";
import type { WorkspaceDiff } from "../workspace/index.ts";
import { git } from "../workspace/git.ts";
import { runEvaluators, scoreSummary } from "./evaluate.ts";
import type { EvaluatorFactory } from "./evaluate.ts";
import type { PlannedRun, PricingTable } from "./planner.ts";
import { costFromTokens, priceFor } from "./planner.ts";
import { sweepTree } from "./procs.ts";
import type { Clock } from "./clock.ts";
import type { EvaluatorKind } from "../core/schemas.ts";

const MAX_DIFF_CHARS = 200_000;
export const SECRET_NOTE = "secretos detectados";

export interface CycleDeps {
  benchRoot: string;
  runBase: string | undefined;
  clock: Clock;
  keepRunDirs: boolean;
  extraPath: string[];
  extraEvaluators: Partial<Record<EvaluatorKind, EvaluatorFactory>>;
  pricing: PricingTable | undefined;
  killGraceMs: number;
  /** registro de raíces activas (apagado de emergencia) */
  activeRoots: Set<string>;
  cliVersion: string | null;
  capabilities: Capabilities;
  benchVersion: string;
}

export interface CycleInput {
  experiment: Experiment;
  planned: PlannedRun;
  scenario: Scenario;
  configuration: Configuration;
  runner: AgentRunner;
  signal: AbortSignal;
  deps: CycleDeps;
}

let gitVersionCache: string | null | undefined;
function gitVersion(): string | null {
  if (gitVersionCache !== undefined) return gitVersionCache;
  try { gitVersionCache = execFileSync("git", ["--version"], { encoding: "utf8", timeout: 5000 }).trim().replace(/^git version /, ""); }
  catch { gitVersionCache = null; }
  return gitVersionCache;
}

export function readBenchVersion(): string {
  try {
    const p = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(p, "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch { return "0.0.0"; }
}

export function buildEnvironment(cliVersion: string | null, benchVersion: string): Environment {
  return {
    schemaVersion: SCHEMA_VERSION, os: platform(), arch: arch(), nodeVersion: process.versions.node, gitVersion: gitVersion(),
    cliVersion, ncpu: Math.max(1, cpus().length), totalMemBytes: Math.max(1, totalmem()), benchVersion, isolation: "none",
  };
}

/** Workspace limpio: git archive del commit del fixture, o copia + git init fresco si no es un repo con commit. */
async function setupWorkspace(scenario: Scenario, ws: string, benchRoot: string): Promise<void> {
  const src = resolve(benchRoot, scenario.fixture.path);
  if (scenario.fixture.commit) {
    await createWorkspace({ fixtureRepo: src, commit: scenario.fixture.commit, dir: ws });
    return;
  }
  await cp(src, ws, { recursive: true, filter: (p) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(p.slice(src.length)) });
  await git(ws, ["init", "-q", "-b", "main"]);
  await git(ws, ["add", "-A"]);
  await git(ws, ["-c", "user.name=agent-bench", "-c", "user.email=bench@localhost", "commit", "-q", "--allow-empty", "-m", "base"]);
}

async function stageHidden(scenario: Scenario, layout: RunLayout, benchRoot: string): Promise<string | null> {
  if (!scenario.hiddenTests) return null;
  const src = resolve(benchRoot, scenario.hiddenTests);
  const inject = typeof scenario.metadata.hiddenInject === "string" ? scenario.metadata.hiddenInject : null;
  if (!inject) return src;
  const stage = join(layout.root, "hidden-stage");
  await mkdir(join(stage, inject), { recursive: true });
  await cp(src, join(stage, inject), { recursive: true });
  return stage;
}

function costOf(t: Telemetry, cfg: Configuration, pricing: PricingTable | undefined): { usd: number | null; known: boolean } {
  if (t.costUsd !== null) return { usd: t.costUsd, known: true };
  const price = priceFor(pricing, cfg);
  if (price && t.totalTokens !== null) return { usd: costFromTokens(price, t.totalTokens), known: true };
  return { usd: null, known: false };
}
export { costOf };

async function listOutFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await readdir(d, { withFileTypes: true }).catch(() => [])) {
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p); else if (e.isFile()) out.push(p);
    }
  };
  await walk(dir);
  return out;
}

/** Artefactos del run (out/) deben estar sin secretos; devuelve archivos con coincidencias. */
export async function scanOutForSecrets(outDir: string, containsSecret: (t: string) => boolean): Promise<string[]> {
  const hits: string[] = [];
  for (const f of await listOutFiles(outDir)) {
    try {
      const buf = await readFile(f);
      if (buf.length <= 2_000_000 && containsSecret(buf.toString("utf8"))) hits.push(f);
    } catch { /* ilegible: se ignora */ }
  }
  return hits;
}

/** Un ciclo completo y aislado. Siempre devuelve un RunResult (los fallos del banco => infra_error). */
export async function executeCycle(inp: CycleInput): Promise<RunResult> {
  const { experiment, planned, scenario, configuration, runner, signal, deps } = inp;
  const { clock } = deps;
  const runId = newRunId();
  const startedMs = clock.now();
  const startedAt = new Date(startedMs).toISOString();
  const notes: string[] = [];
  let outcome: Outcome = "infra_error";
  let telemetry = emptyTelemetry();
  let evaluators: RunResult["evaluators"] = [];
  let orphans: number | null = null;
  let patch: string | null = null;
  let durationMs = 0;
  let success: boolean | null = null;
  let scores: RunResult["score"] = { correctness: null, quality: null, efficiency: null };
  let layout: RunLayout | null = null;
  let prepared: Awaited<ReturnType<AgentRunner["prepare"]>> | null = null;
  let diff: WorkspaceDiff | null = null;
  let treeDead = new TreeDeadSignal();
  let rawPid: number | null = null;
  let runnerRan = false;

  try {
    layout = createRunLayout(runId, deps.runBase);
    deps.activeRoots.add(layout.root);
    await setupWorkspace(scenario, layout.ws, deps.benchRoot);
    const env = buildEnv(layout, { extraPath: deps.extraPath });
    const ctx: RunContext = {
      runId, runRoot: layout.root, workspace: layout.ws, home: layout.home, tmp: layout.tmp, out: layout.out, env, seed: planned.seed,
    };
    prepared = await runner.prepare(ctx, configuration);

    // --- run ---
    let collectedOutcome: Outcome | null = null;
    let raw: Awaited<ReturnType<AgentRunner["run"]>> | null = null;
    try {
      raw = await runner.run(prepared, { scenarioId: scenario.id, prompt: scenario.task }, experiment.limits, signal);
      runnerRan = true;
      durationMs = Math.max(0, Math.round(raw.durationMs));
      outcome = raw.outcome;
      if (raw.error) notes.push(redactText(raw.error).slice(0, 500));
      const pid = (raw.raw as Record<string, unknown>).pid;
      rawPid = typeof pid === "number" ? pid : null;
    } catch (e) {
      outcome = "infra_error";
      notes.push(`run falló: ${redactText(String(e)).slice(0, 500)}`);
    }

    // --- árbol del agente muerto (killTree + verificación) antes de tocar nada oculto ---
    const sweep = await sweepTree({ pid: rawPid, roots: [layout.root], graceMs: deps.killGraceMs });
    if (sweep.targeted.length) notes.push(`barrido: ${sweep.targeted.length} proceso(s) vivos tras run`);
    if (sweep.leftover.length === 0 && verifyNoOrphans(sweep.targeted).length === 0) treeDead.markDead();
    else {
      orphans = sweep.leftover.length;
      outcome = "infra_error";
      notes.push(`no se pudo matar el árbol del agente: ${sweep.leftover.join(",")}`);
    }

    // --- collect ---
    if (raw && runnerRan) {
      try {
        const c = await runner.collect(prepared, raw);
        collectedOutcome = c.outcome;
        telemetry = maskTelemetry(c.telemetry, deps.capabilities);
      } catch (e) {
        notes.push(`collect falló: ${redactText(String(e)).slice(0, 300)}`);
        if (outcome === "completed") outcome = "infra_error";
      }
      if (collectedOutcome && outcome !== "infra_error") outcome = collectedOutcome;
      else if (collectedOutcome === "infra_error") outcome = "infra_error";
    }

    // --- diff observado por el banco (independiente del runner) ---
    try {
      diff = await captureDiff(layout.ws);
      patch = diff.patch.length > MAX_DIFF_CHARS ? diff.patch.slice(0, MAX_DIFF_CHARS) + "\n[... truncado]" : diff.patch;
      telemetry = {
        ...telemetry, filesModified: diff.modified, filesCreated: diff.created, filesDeleted: diff.deleted,
        extra: { ...telemetry.extra, filesDiffObservedByBench: true },
      };
    } catch (e) {
      notes.push(`diff falló: ${String(e).slice(0, 200)}`);
    }

    // --- evaluadores (solo con el árbol muerto; ocultos solo en la copia de evaluación) ---
    const evaluable = treeDead.dead && diff !== null && runnerRan && outcome !== "cancelled" && outcome !== "infra_error" && outcome !== "rate_limited";
    if (evaluable) {
      try {
        const hiddenDir = await stageHidden(scenario, layout, deps.benchRoot);
        const ec = await createEvalCopy({ workspaceDir: layout.ws, evalDir: layout.eval, hiddenDir, treeDead, timeoutMs: 10_000 });
        const out = await runEvaluators(
          scenario,
          { workspaceDir: layout.ws, evalDir: ec.evalDir, hiddenFiles: ec.hiddenFiles, diff: diff!, env },
          deps.extraEvaluators,
        );
        evaluators = out.results;
        scores = scoreSummary(scenario, out.results);
        if (outcome !== "completed") success = false;
        else if (out.failed) success = false;
        else success = out.indeterminate ? null : true;
      } catch (e) {
        notes.push(`evaluación falló: ${redactText(String(e)).slice(0, 300)}`);
        outcome = "infra_error";
      }
    }
  } catch (e) {
    outcome = "infra_error";
    notes.push(`ciclo falló: ${redactText(String(e)).slice(0, 500)}`);
  }

  // --- cleanup del runner + barrido final ---
  let cleanupOrphans = 0;
  if (prepared) {
    try { cleanupOrphans = (await runner.cleanup(prepared)).orphans; }
    catch (e) { notes.push(`cleanup falló: ${redactText(String(e)).slice(0, 200)}`); cleanupOrphans = 1; }
  }
  let finalLeft = 0;
  if (layout) {
    try { finalLeft = (await sweepTree({ pid: rawPid, roots: [layout.root], graceMs: deps.killGraceMs })).leftover.length; }
    catch { finalLeft = 1; }
    const total = cleanupOrphans + finalLeft;
    if (total > 0 || orphans === null) orphans = Math.max(orphans ?? 0, total);
    // el árbol que sobrevive a la limpieza impide fiarse del resultado
    if (total > 0 && outcome !== "cancelled") { outcome = "infra_error"; success = null; }
  }

  // --- artefactos limpios de secretos (daño potencial) ---
  if (layout) {
    try {
      const hits = await scanOutForSecrets(layout.out, containsSecret);
      if (hits.length) notes.push(`${SECRET_NOTE} en artefactos: ${hits.length} archivo(s)`);
    } catch { /* sin escaneo */ }
  }

  if (outcome === "infra_error" || outcome === "cancelled" || outcome === "rate_limited") success = null;
  if (outcome === "timeout" || outcome === "hung" || outcome === "agent_error") success = false;

  // --- limpiar ---
  if (layout) {
    deps.activeRoots.delete(layout.root);
    if (!deps.keepRunDirs) {
      try { removeRunLayout(layout); } catch (e) { notes.push(`no se pudo borrar ${layout.root}: ${String(e).slice(0, 100)}`); }
    }
  }

  const finishedMs = clock.now();
  if (!durationMs) durationMs = Math.max(0, finishedMs - startedMs);
  const result: RunResult = {
    schemaVersion: SCHEMA_VERSION,
    runId,
    experimentId: experiment.id,
    scenarioId: scenario.id,
    configurationId: configuration.id,
    runner: configuration.runner,
    provider: configuration.provider,
    model: configuration.model,
    cliVersion: deps.cliVersion,
    features: { skills: configuration.skills, subagents: configuration.subagents },
    repetition: planned.repetition,
    seed: planned.seed,
    startedAt,
    finishedAt: new Date(finishedMs).toISOString(),
    outcome,
    success,
    telemetry,
    durationMs,
    evaluators,
    score: scores,
    orphans,
    gitDiff: patch,
    error: notes.length ? notes.join(" | ").slice(0, 2000) : null,
    environment: buildEnvironment(deps.cliVersion, deps.benchVersion),
  };
  return RunResultSchema.parse(result);
}

