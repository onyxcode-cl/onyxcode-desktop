import { ExperimentSchema } from "../core/schemas.ts";
import type { AgentRunner, Capabilities, Configuration, EvaluatorKind, Experiment, RunResult, Scenario } from "../core/schemas.ts";
import { loadGate } from "../isolation/index.ts";
import type { GateDecision } from "../isolation/index.ts";
import type { Store } from "../store/index.ts";
import { checkExperimentRefs, ConfigError } from "./config.ts";
import { realClock } from "./clock.ts";
import type { Clock } from "./clock.ts";
import { costOf, credentialNames, executeCycle, pickCredentials, readBenchVersion, SECRET_NOTE, secretsOf } from "./cycle.ts";
import { hashConfiguration, hashScenario } from "./hashes.ts";
import { git } from "../workspace/git.ts";
import { resolve } from "node:path";
import type { CycleDeps } from "./cycle.ts";
import type { EvaluatorFactory } from "./evaluate.ts";
import { dirname } from "node:path";
import { planExperiment, priceFor, runKeyOf } from "./planner.ts";
import type { Plan, PlannedRun, PricingTable } from "./planner.ts";
import { emergencyKill } from "./procs.ts";

export type StopReason = "error" | "budget_cost" | "budget_runs" | "budget_wall" | "infra_errors" | "damage" | "load_gate" | "cancelled";
export type ExperimentStatus = "completed" | "stopped" | "cancelled" | "dry-run" | "refused";

export type EngineEvent =
  | { type: "start"; experimentId: string; runs: number; skipped: number }
  | { type: "run-start"; key: string; scenarioId: string; configurationId: string; repetition: number; attempt: number }
  | { type: "run-end"; key: string; runId: string; outcome: RunResult["outcome"]; success: boolean | null; attempt: number }
  | { type: "retry"; key: string; attempt: number; delayMs: number }
  | { type: "gate-pause"; reason: string; pausedMs: number }
  | { type: "stop"; reason: StopReason; detail: string }
  | { type: "end"; status: ExperimentStatus };

export interface RunExperimentOptions {
  store: Store;
  scenarios: readonly Scenario[];
  configurations: readonly Configuration[];
  /** por id de runner (Configuration.runner). Runners con interfaz local antigua: adaptLegacyRunner(). */
  runners: Readonly<Record<string, AgentRunner>>;
  /** raíz del repo del banco: las rutas de Scenario.fixture/hiddenTests son relativas a ella */
  benchRoot: string;
  /** base de los workspaces (def ~/ab/r) */
  runBase?: string;
  dryRun?: boolean;
  /** omite los runs ya completados en el store (def true) */
  resume?: boolean;
  signal?: AbortSignal;
  /** instala manejadores SIGINT/SIGTERM (def true; el CLI los quiere, los tests no) */
  handleSignals?: boolean;
  clock?: Clock;
  /** load gate; def: loadGate() de src/isolation */
  gate?: () => GateDecision;
  gatePollMs?: number;
  /** pausa acumulada máxima por load gate antes de parar (def 30 min) */
  gateMaxPauseMs?: number;
  pricing?: PricingTable;
  /** coste que se asume por run cuando ni el runner ni la tabla de precios lo dan (def 0) */
  assumedCostPerRunUsd?: number;
  retry?: { max?: number; baseMs?: number; capMs?: number };
  infraStop?: { ratio?: number; minRuns?: number };
  /** daño adicional detectado por el llamante; devuelve texto si hay daño */
  detectDamage?: (r: RunResult) => string | null;
  extraEvaluators?: Partial<Record<EvaluatorKind, EvaluatorFactory>>;
  extraPath?: string[];
  keepRunDirs?: boolean;
  killGraceMs?: number;
  /** entorno del que se toman SOLO las variables de credencial que declaran runner/configuración (def process.env) */
  parentEnv?: NodeJS.ProcessEnv;
  /** evaluadores de código del agente dentro de Seatbelt (def: si hay sandbox-exec) */
  sandboxEvaluators?: boolean;
  onEvent?: (e: EngineEvent) => void;
}

export interface ExperimentSummary {
  schemaVersion: "1";
  experimentId: string;
  status: ExperimentStatus;
  stopReason: StopReason | null;
  stopDetail: string | null;
  plan: Plan;
  /** runs persistidos en esta invocación (resultado final por unidad planificada) */
  results: RunResult[];
  /** unidades omitidas por reanudación */
  skipped: number;
  /** unidades planificadas sin ejecutar por la parada */
  pending: number;
  attempts: number;
  retries: number;
  spentUsd: number;
  costUnknownRuns: number;
  wallMs: number;
  pausedMs: number;
  infraErrorRate: number;
  /** motivos del rechazo previo (status refused) */
  refusal: string | null;
  /** avisos (p. ej. runs previos de otra versión de configuración/caso que no se reutilizan) */
  warnings: string[];
}

const DONE_OUTCOMES = new Set(["completed", "agent_error", "timeout", "hung"]);

export class BudgetError extends Error {
  constructor(message: string) { super(message); this.name = "BudgetError"; }
}

export function validateBudget(exp: Experiment): void {
  const m = exp.budget.maxCost;
  if (typeof m !== "number" || !Number.isFinite(m) || m < 0) throw new BudgetError("budget.maxCost es obligatorio (USD, >= 0)");
}

export async function runExperiment(experimentIn: Experiment, o: RunExperimentOptions): Promise<ExperimentSummary> {
  const exp = ExperimentSchema.parse(experimentIn);
  validateBudget(exp);
  const clock = o.clock ?? realClock;
  const emit = (e: EngineEvent): void => { try { o.onEvent?.(e); } catch { /* el observador no rompe el motor */ } };

  const cfgs = new Map(o.configurations.map((c) => [c.id, c]));
  const scs = new Map(o.scenarios.map((s) => [s.id, s]));
  const refErrors = checkExperimentRefs(exp, o.scenarios, o.configurations, Object.keys(o.runners));
  if (refErrors.length) throw new ConfigError(`experimento ${exp.id}: referencias inválidas`, refErrors);

  const existing = o.store.loadRuns(exp.id);
  const plan = planExperiment(exp, {
    configurations: o.configurations, history: existing,
    ...(o.pricing ? { pricing: o.pricing } : {}),
  });
  const base: ExperimentSummary = {
    schemaVersion: "1", experimentId: exp.id, status: "dry-run", stopReason: null, stopDetail: null, plan, results: [], skipped: 0,
    pending: plan.runs.length, attempts: 0, retries: 0, spentUsd: 0, costUnknownRuns: 0, wallMs: 0, pausedMs: 0, infraErrorRate: 0, refusal: null,
    warnings: [],
  };
  if (o.dryRun) return base;

  // ---- preflight: runners disponibles y coste controlable ----
  const caps = new Map<string, { version: string | null; capabilities: Capabilities }>();
  const used = [...new Set(exp.configurations.map((c) => cfgs.get(c)!.runner))];
  for (const rid of used) {
    const p = await o.runners[rid]!.probe();
    if (!p.available) return { ...base, status: "refused", refusal: `runner no disponible: ${rid}${p.notes ? ` (${p.notes})` : ""}` };
    caps.set(rid, { version: p.version, capabilities: p.capabilities });
  }
  const uncontrolled = exp.configurations.filter((id) => {
    const c = cfgs.get(id)!;
    if (/^fake/.test(c.runner)) return false;
    return !caps.get(c.runner)!.capabilities.cost && !priceFor(o.pricing, c) && o.assumedCostPerRunUsd === undefined;
  });
  if (uncontrolled.length && exp.budget.maxRuns === null) {
    return { ...base, status: "refused", refusal: `coste no controlable para ${uncontrolled.join(", ")}: define budget.maxRuns, una tabla de precios o assumedCostPerRunUsd` };
  }
  if (plan.estimate.costUsdTotal !== null && plan.estimate.costUsdTotal > exp.budget.maxCost) {
    return { ...base, status: "refused", refusal: `coste estimado ${plan.estimate.costUsdTotal.toFixed(2)} USD > maxCost ${exp.budget.maxCost}; sube el tope o reduce el plan` };
  }

  // ---- versiones de contenido (A6): la reanudación solo reutiliza runs hechos con la MISMA configuración y caso ----
  const cfgHash = new Map<string, string>();
  const caseHash = new Map<string, string>();
  for (const id of exp.configurations) cfgHash.set(id, hashConfiguration(cfgs.get(id)!, o.benchRoot));
  for (const id of exp.scenarios) {
    const sc = scs.get(id)!;
    let tree: string | null = null;
    if (sc.fixture.commit) {
      try { tree = (await git(resolve(o.benchRoot, sc.fixture.path), ["rev-parse", "--verify", `${sc.fixture.commit}^{tree}`])).trim(); } catch { tree = null; }
    }
    caseHash.set(id, hashScenario(sc, o.benchRoot, tree));
  }
  // ---- credenciales: solo las declaradas; sus valores se registran en el redactor del store ----
  const parentEnv = o.parentEnv ?? process.env;
  for (const cid of exp.configurations) {
    const c = cfgs.get(cid)!;
    o.store.addSecrets(secretsOf(pickCredentials(credentialNames(o.runners[c.runner]!, c), parentEnv)));
  }

  // ---- reanudación ----
  const doneKeys = new Set<string>();
  const stale: string[] = [];
  let unhashed = 0;
  if (o.resume !== false) {
    for (const r of existing) {
      if (!DONE_OUTCOMES.has(r.outcome)) continue;
      const ch = cfgHash.get(r.configurationId);
      const sh = caseHash.get(r.scenarioId);
      if (r.configHash === null || r.caseHash === null) { unhashed++; doneKeys.add(runKeyOf(r)); continue; }
      if ((ch !== undefined && r.configHash !== ch) || (sh !== undefined && r.caseHash !== sh)) {
        stale.push(`${r.scenarioId}/${r.configurationId}#${r.repetition}`);
        continue;
      }
      doneKeys.add(runKeyOf(r));
    }
  }
  if (stale.length) {
    const w = `${stale.length} run(s) previo(s) usan otra versión de la configuración o del caso (contenido distinto) y NO se reutilizan: se repetirán. Ejemplos: ${stale.slice(0, 3).join(", ")}`;
    base.warnings.push(w);
    base.plan.warnings.push(w);
  }
  if (unhashed) {
    const w = `${unhashed} run(s) previo(s) sin hash de contenido (anteriores a A6): se reutilizan sin poder verificar su versión`;
    base.warnings.push(w);
    base.plan.warnings.push(w);
  }
  const queue: PlannedRun[] = plan.runs.filter((r) => !doneKeys.has(r.key));
  const skipped = plan.runs.length - queue.length;
  o.store.writeExperiment(exp);
  o.store.appendJournal(exp.id, { event: "start", runs: plan.runs.length, skipped, concurrency: exp.concurrency });
  emit({ type: "start", experimentId: exp.id, runs: plan.runs.length, skipped });

  // ---- estado ----
  const ctl = new AbortController();
  let stop: { reason: StopReason; detail: string } | null = null;
  const setStop = (reason: StopReason, detail: string, abort = false): void => {
    if (stop) return;
    stop = { reason, detail };
    o.store.appendJournal(exp.id, { event: "stop", reason, detail });
    emit({ type: "stop", reason, detail });
    if (abort) ctl.abort();
  };
  if (o.signal) {
    if (o.signal.aborted) setStop("cancelled", "señal externa", true);
    else o.signal.addEventListener("abort", () => setStop("cancelled", "AbortSignal externo", true), { once: true });
  }
  const activeRoots = new Set<string>();
  let signalCount = 0;
  const onSig = (name: string) => (): void => {
    signalCount++;
    if (signalCount === 1) setStop("cancelled", `${name}: apagado limpio`, true);
    else { emergencyKill([...activeRoots]); process.exit(130); }
  };
  const handlers: Array<[NodeJS.Signals, () => void]> = [["SIGINT", onSig("SIGINT")], ["SIGTERM", onSig("SIGTERM")]];
  if (o.handleSignals !== false) for (const [s, h] of handlers) process.on(s, h);

  const t0 = clock.now();
  const wallCtl = new AbortController();
  // Con reloj real, el tope de tiempo también aborta un run en curso; con reloj inyectado solo lo comprueba admit().
  if (exp.budget.maxWallSec !== null && o.clock === undefined) {
    const timer = setTimeout(() => setStop("budget_wall", `tope de tiempo ${exp.budget.maxWallSec} s`, true), exp.budget.maxWallSec * 1000);
    timer.unref();
    wallCtl.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  }

  const retryMax = o.retry?.max ?? 3;
  const retryBase = o.retry?.baseMs ?? 2000;
  const retryCap = o.retry?.capMs ?? 60_000;
  const infraRatio = o.infraStop?.ratio ?? 0.2;
  const infraMin = o.infraStop?.minRuns ?? 5;
  const gate = o.gate ?? ((): GateDecision => loadGate());
  const gatePoll = o.gatePollMs ?? 5000;
  const gateMax = o.gateMaxPauseMs ?? 30 * 60_000;

  const benchVersion = readBenchVersion();
  const results: RunResult[] = [];
  let attempts = 0, retries = 0, spent = 0, costUnknown = 0, inflight = 0, pausedMs = 0, infraN = 0, finalN = 0;
  const costSamples: number[] = [];
  const assumed = o.assumedCostPerRunUsd ?? 0;
  const estPerRun = (): number => (costSamples.length ? costSamples.reduce((a, b) => a + b, 0) / costSamples.length : plan.estimate.costUsdPerRun ?? assumed);

  /** Comprueba presupuestos y load gate; true = puede lanzar otro intento. */
  async function admit(): Promise<boolean> {
    for (;;) {
      if (stop) return false;
      if (ctl.signal.aborted) { setStop("cancelled", "abortado", false); return false; }
      if (exp.budget.maxRuns !== null && attempts >= exp.budget.maxRuns) { setStop("budget_runs", `tope de intentos ${exp.budget.maxRuns}`); return false; }
      if (exp.budget.maxWallSec !== null && clock.now() - t0 >= exp.budget.maxWallSec * 1000) { setStop("budget_wall", `tope de tiempo ${exp.budget.maxWallSec} s`, true); return false; }
      const projected = spent + (inflight + 1) * estPerRun();
      if (spent > exp.budget.maxCost + 1e-9 || projected > exp.budget.maxCost + 1e-9) {
        setStop("budget_cost", `gastado ${spent.toFixed(4)} USD; el siguiente run proyecta ${projected.toFixed(4)} > ${exp.budget.maxCost}`);
        return false;
      }
      let d: GateDecision;
      try { d = gate(); } catch { d = { schemaVersion: "1", status: "ok", metrics: { loadPerCpu: 0, ncpu: 1, freeMemMB: null, thermal: "unknown" } }; }
      if (d.status === "ok") return true;
      emit({ type: "gate-pause", reason: d.reason, pausedMs });
      o.store.appendJournal(exp.id, { event: "gate-pause", reason: d.reason, pausedMs });
      if (pausedMs >= gateMax) { setStop("load_gate", `carga alta sostenida: ${d.reason}`); return false; }
      await clock.sleep(gatePoll, ctl.signal);
      pausedMs += gatePoll;
    }
  }

  const damageOf = (r: RunResult): string | null => {
    if (r.orphans !== null && r.orphans > 0) return `${r.orphans} proceso(s) huérfano(s) sobrevivieron al run ${r.runId}`;
    if (r.error?.includes(SECRET_NOTE)) return `secretos en artefactos del run ${r.runId}`;
    if (r.error?.includes("no se pudo borrar")) return `no se pudo limpiar el workspace del run ${r.runId}`;
    return o.detectDamage?.(r) ?? null;
  };

  async function attempt(item: PlannedRun, n: number): Promise<RunResult> {
    const cfg = cfgs.get(item.configurationId)!;
    const sc = scs.get(item.scenarioId)!;
    const rc = caps.get(cfg.runner)!;
    const deps: CycleDeps = {
      benchRoot: o.benchRoot, runBase: o.runBase, clock, keepRunDirs: o.keepRunDirs ?? false,
      extraPath: [dirname(process.execPath), ...(o.extraPath ?? [])], extraEvaluators: o.extraEvaluators ?? {},
      pricing: o.pricing, killGraceMs: o.killGraceMs ?? 1000, activeRoots, cliVersion: rc.version,
      capabilities: rc.capabilities, benchVersion, parentEnv,
      ...(o.sandboxEvaluators !== undefined ? { sandboxEvaluators: o.sandboxEvaluators } : {}),
    };
    emit({ type: "run-start", key: item.key, scenarioId: item.scenarioId, configurationId: item.configurationId, repetition: item.repetition, attempt: n });
    inflight++;
    attempts++;
    try {
      const r = await executeCycle({ experiment: exp, planned: item, scenario: sc, configuration: cfg, runner: o.runners[cfg.runner]!, signal: ctl.signal, deps, hashes: { config: cfgHash.get(cfg.id)!, case: caseHash.get(sc.id)! } });
      const c = costOf(r.telemetry, cfg, o.pricing);
      if (c.usd !== null) { spent += c.usd; costSamples.push(c.usd); }
      else { spent += assumed; costUnknown++; }
      emit({ type: "run-end", key: item.key, runId: r.runId, outcome: r.outcome, success: r.success, attempt: n });
      o.store.appendJournal(exp.id, { event: "attempt", key: item.key, runId: r.runId, attempt: n, outcome: r.outcome, costUsd: c.usd });
      return r;
    } finally {
      inflight--;
    }
  }

  async function runUnit(item: PlannedRun): Promise<void> {
    let n = 1;
    let r = await attempt(item, n);
    while (r.outcome === "rate_limited" && n <= retryMax) {
      const exp2 = Math.min(retryCap, retryBase * 2 ** (n - 1));
      const delay = Math.round(exp2 / 2 + clock.random() * (exp2 / 2));
      emit({ type: "retry", key: item.key, attempt: n + 1, delayMs: delay });
      o.store.appendJournal(exp.id, { event: "retry", key: item.key, attempt: n + 1, delayMs: delay });
      const slept = await clock.sleep(delay, ctl.signal);
      if (!slept || !(await admit())) break;
      n++; retries++;
      r = await attempt(item, n);
    }
    const saved = o.store.writeRun(r);
    results.push(saved);
    finalN++;
    if (saved.outcome === "infra_error") infraN++;
    const dmg = damageOf(saved);
    if (dmg) setStop("damage", dmg);
    else if (finalN >= infraMin && infraN / finalN > infraRatio) setStop("infra_errors", `${infraN}/${finalN} runs con infra_error (> ${Math.round(infraRatio * 100)} %)`);
  }

  async function worker(): Promise<void> {
    for (;;) {
      if (!(await admit())) return;
      const item = queue.shift();
      if (!item) return;
      await runUnit(item);
    }
  }

  const workerErrors: unknown[] = [];
  try {
    // M7: si un worker revienta se detiene el resto (abort) y se espera a TODOS antes de quitar los manejadores de señal
    const settled = await Promise.allSettled(Array.from({ length: exp.concurrency }, () => worker().catch((e: unknown) => {
      workerErrors.push(e);
      setStop("error", `fallo interno del motor: ${String(e).slice(0, 300)}`, true);
      throw e;
    })));
    void settled;
  } finally {
    wallCtl.abort();
    if (o.handleSignals !== false) for (const [s, h] of handlers) process.off(s, h);
  }

  const finalStop = stop as { reason: StopReason; detail: string } | null;
  const status: ExperimentStatus = finalStop ? (finalStop.reason === "cancelled" ? "cancelled" : "stopped") : "completed";
  o.store.appendJournal(exp.id, { event: "end", status, stopReason: finalStop?.reason ?? null, attempts, retries, spentUsd: spent });
  emit({ type: "end", status });
  if (workerErrors.length) base.warnings.push(`fallo interno del motor (${workerErrors.length} worker(s)): ${String(workerErrors[0]).slice(0, 200)}`);
  return {
    ...base, status, stopReason: finalStop?.reason ?? null, stopDetail: finalStop?.detail ?? null, results, skipped, pending: queue.length,
    attempts, retries, spentUsd: spent, costUnknownRuns: costUnknown, wallMs: clock.now() - t0, pausedMs,
    infraErrorRate: finalN ? infraN / finalN : 0, refusal: null,
  };
}

