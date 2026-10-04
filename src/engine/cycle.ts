import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, readdir, readFile } from "node:fs/promises";
import { writeFileNoFollow } from "../core/safefs.ts";
import { arch, cpus, platform, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { newRunId } from "../core/ids.ts";
import { verifyNoOrphans } from "../core/proc.ts";
import { containsSecret, redactDeep, redactText } from "../core/redact.ts";
import { emptyTelemetry, maskTelemetry, RunResultSchema, SCHEMA_VERSION } from "../core/schemas.ts";
import type {
  AgentRunner, Capabilities, Configuration, Environment, Experiment, Outcome, RunContext, RunResult, Scenario, Telemetry,
} from "../core/schemas.ts";
import { buildEnv, createRunLayout, removeRunLayout, sandboxAvailable } from "../isolation/index.ts";
import type { RunLayout } from "../isolation/index.ts";
import { captureDiff, createEvalCopy, createWorkspace, TreeDeadSignal } from "../workspace/index.ts";
import { initBaseRepo } from "../workspace/create.ts";
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
  /** entorno del que se toman SOLO las variables de credencial declaradas (def: process.env) */
  parentEnv?: NodeJS.ProcessEnv;
  /** correr los evaluadores de código del agente dentro de Seatbelt (def: si hay sandbox-exec) */
  sandboxEvaluators?: boolean;
}

export interface CycleInput {
  experiment: Experiment;
  planned: PlannedRun;
  scenario: Scenario;
  configuration: Configuration;
  runner: AgentRunner;
  signal: AbortSignal;
  deps: CycleDeps;
  /** hashes de contenido de la versión de la configuración y del caso (A6) */
  hashes?: { config: string; case: string };
}

/**
 * Variables de credencial que se reenvían al runner: las declaradas por el runner (`credentialEnv`) y por la
 * configuración (`settings.credentialEnv`); jamás el entorno completo (A2).
 */
export function credentialNames(runner: AgentRunner, cfg: Configuration): string[] {
  const fromCfg = (cfg.settings as { credentialEnv?: unknown }).credentialEnv;
  const names = [...(runner.credentialEnv ?? []), ...(Array.isArray(fromCfg) ? fromCfg.filter((x): x is string => typeof x === "string") : [])];
  return [...new Set(names.filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n)))];
}

export function pickCredentials(names: readonly string[], parent: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) { const v = parent[n]; if (v !== undefined && v !== "") out[n] = v; }
  return out;
}

/** Secretos a redactar: cada valor de credencial entero y cada cadena larga dentro de valores JSON (p. ej. OPENCODE_AUTH_CONTENT). */
export function secretsOf(cred: Record<string, string>): string[] {
  const out = new Set<string>();
  const leaves = (v: unknown): void => {
    if (typeof v === "string") { if (v.length >= 8) out.add(v); }
    else if (Array.isArray(v)) v.forEach(leaves);
    else if (v && typeof v === "object") Object.values(v).forEach(leaves);
  };
  for (const v of Object.values(cred)) {
    if (v.length >= 6) out.add(v);
    try { leaves(JSON.parse(v)); } catch { /* no es JSON */ }
  }
  return [...out];
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

export function buildEnvironment(cliVersion: string | null, benchVersion: string, isolation: Environment["isolation"] = "none"): Environment {
  return {
    schemaVersion: SCHEMA_VERSION, os: platform(), arch: arch(), nodeVersion: process.versions.node, gitVersion: gitVersion(),
    cliVersion, ncpu: Math.max(1, cpus().length), totalMemBytes: Math.max(1, totalmem()), benchVersion, isolation,
  };
}

/**
 * Workspace limpio: git archive del commit del fixture, o copia + git init fresco si no es un repo con commit.
 * El repo del banco vive en `gitDir` (ctl/, no escribible por el agente) y se devuelve el hash base: el diff
 * final se calcula siempre contra él, aunque el agente haga commit/reset (A3).
 */
async function setupWorkspace(scenario: Scenario, ws: string, benchRoot: string, gitDir: string): Promise<string> {
  const src = resolve(benchRoot, scenario.fixture.path);
  if (scenario.fixture.commit) {
    return (await createWorkspace({ fixtureRepo: src, commit: scenario.fixture.commit, dir: ws, gitDir })).baseCommit;
  }
  await cp(src, ws, { recursive: true, filter: (p) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(p.slice(src.length)) });
  return initBaseRepo(ws, gitDir);
}

async function stageHidden(scenario: Scenario, layout: RunLayout, benchRoot: string): Promise<string | null> {
  if (!scenario.hiddenTests) return null;
  const src = resolve(benchRoot, scenario.hiddenTests);
  const inject = typeof scenario.metadata.hiddenInject === "string" ? scenario.metadata.hiddenInject : null;
  if (!inject) return src;
  // ctl/ no es escribible por el agente (Seatbelt): el staging no puede redirigirse con symlinks
  const stage = join(layout.ctl, "hidden-stage");
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
  const { experiment, planned, scenario, configuration, runner, signal, deps, hashes } = inp;
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
  let baseCommit: string | null = null;
  let gitDir: string | null = null;
  let secrets: string[] = [];
  // aislamiento real: lo declara el runner (propiedad `isolation`); los reales exigen Seatbelt operativo
  const declared = (runner as { isolation?: unknown }).isolation;
  const isolation: Environment["isolation"] = declared === "seatbelt" && sandboxAvailable() ? "seatbelt" : "none";
  const isFake = /^fake/.test(runner.id) && /^fake/.test(configuration.runner);

  try {
    if (!isFake && isolation !== "seatbelt") {
      throw new Error(`rehúso correr el runner real "${runner.id}" sin aislamiento Seatbelt (sandbox-exec no disponible o desactivado)`);
    }
    layout = createRunLayout(runId, deps.runBase);
    deps.activeRoots.add(layout.root);
    gitDir = join(layout.ctl, "gitdir");
    baseCommit = await setupWorkspace(scenario, layout.ws, deps.benchRoot, gitDir);
    // A2: solo las credenciales declaradas llegan al runner; nunca el entorno completo
    const cred = pickCredentials(credentialNames(runner, configuration), deps.parentEnv ?? process.env);
    secrets = secretsOf(cred);
    const env = buildEnv(layout, { extraPath: deps.extraPath, extra: cred });
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
      diff = await captureDiff(layout.ws, baseCommit!, { gitDir: gitDir! });
      patch = diff.patch.length > MAX_DIFF_CHARS ? diff.patch.slice(0, MAX_DIFF_CHARS) + "\n[... truncado]" : diff.patch;
      telemetry = {
        ...telemetry, filesModified: diff.modified, filesCreated: diff.created, filesDeleted: diff.deleted,
        extra: { ...telemetry.extra, filesDiffObservedByBench: true },
      };
      if (secrets.some((s) => diff!.patch.includes(s))) notes.push(`${SECRET_NOTE} en el diff del agente (credencial escrita en el workspace)`);
    } catch (e) {
      notes.push(`diff falló: ${String(e).slice(0, 200)}`);
    }

    // --- evaluadores (solo con el árbol muerto; ocultos solo en la copia de evaluación) ---
    const evaluable = treeDead.dead && diff !== null && runnerRan && outcome !== "cancelled" && outcome !== "infra_error" && outcome !== "rate_limited";
    if (evaluable) {
      try {
        const hiddenDir = await stageHidden(scenario, layout, deps.benchRoot);
        const ec = await createEvalCopy({ workspaceDir: layout.ws, evalDir: layout.eval, hiddenDir, treeDead, timeoutMs: 10_000 });
        if (ec.rejectedSymlinks.length) notes.push(`symlinks del agente descartados en la copia de evaluación: ${ec.rejectedSymlinks.slice(0, 5).join(",")}`);
        // el entorno del agente (HOME propio, etc.) NO se hereda: cada evaluador sandboxeado usa HOME/PATH limpios
        const out = await runEvaluators(
          scenario,
          {
            workspaceDir: layout.ws, evalDir: ec.evalDir, hiddenFiles: ec.hiddenFiles, diff: diff!,
            baseCommit: baseCommit!, gitDir: gitDir!, secrets,
            sandbox: deps.sandboxEvaluators ?? sandboxAvailable(),
          },
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
      const hits = await scanOutForSecrets(layout.out, (t) => containsSecret(t, secrets));
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
    environment: buildEnvironment(deps.cliVersion, deps.benchVersion, isolation),
    configHash: hashes?.config ?? null,
    caseHash: hashes?.case ?? null,
  };
  // A1: secretos exactos y sus campos JSON se redactan en todo el resultado
  return RunResultSchema.parse(secrets.length ? redactDeep(result, secrets) : result);
}

