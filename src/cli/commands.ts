import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { doctor } from "../isolation/doctor.ts";
import { estimatePower, minimumDetectableEffect, MAX_SIMS } from "../stats/power.ts";
import { supervise } from "../core/proc.ts";
import { COMMON_OPTS, parseArgs, pick, UsageError, type OptTable, type Parsed } from "./args.ts";
import { EXIT, fail, ok, type CmdResult, type Ctx } from "./ctx.ts";
import { DataError, listConfigurations, listExperimentFiles, listScenarios, loadExperiment } from "./data.ts";
import { BudgetError } from "../engine/engine.ts";
import { procsCiting } from "../engine/procs.ts";
import { pidsWithCwdUnder } from "../telemetry/orphans.ts";
import { ConfigError } from "../engine/config.ts";
import type { ClaimsFile } from "../report/types.ts";
import { loadReport, planFor, runFor } from "./wiring.ts";

export const MAX_CONCURRENCY = 2;

const s = (p: Parsed, k: string): string | undefined => (typeof p.options[k] === "string" ? (p.options[k] as string) : undefined);
const n = (p: Parsed, k: string): number | undefined => (typeof p.options[k] === "number" ? (p.options[k] as number) : undefined);
const b = (p: Parsed, k: string): boolean => p.options[k] === true;

export interface CommandDef {
  summary: string;
  usage: string;
  opts: OptTable;
  run(p: Parsed, ctx: Ctx): Promise<CmdResult>;
}

const resultsDir = (p: Parsed, ctx: Ctx): string => s(p, "results") ?? join(ctx.root, "results");

// ---------- doctor ----------
const doctorCmd: CommandDef = {
  summary: "Comprueba el entorno (node, git, opencode, disco, sandbox)",
  usage: "agent-bench doctor [--json]",
  opts: pick(COMMON_OPTS, ["help", "json"], { "opencode-bin": { kind: "string" } }),
  async run(p) {
    const bin = s(p, "opencode-bin");
    const r = doctor(bin ? { opencodeBin: bin } : {});
    const icon = { ok: "OK   ", warn: "AVISO", fail: "FALLO" } as const;
    const text = [...r.checks.map((c) => `[${icon[c.status]}] ${c.name}: ${c.detail}`), r.ok ? "Entorno listo." : "El entorno tiene fallos: corrígelos antes de ejecutar."].join("\n");
    return { code: r.ok ? EXIT.OK : EXIT.FALLO, data: { ...r }, text };
  },
};

// ---------- validate-cases ----------
const validateCmd: CommandDef = {
  summary: "Valida los casos (base falla, referencia pasa, tramposo detectado)",
  usage: "agent-bench validate-cases [--dir DIR] [--only ID] [--keep] [--timeout SEG] [--json]",
  opts: pick(COMMON_OPTS, ["help", "json", "timeout"], { dir: { kind: "string" }, only: { kind: "string" }, keep: { kind: "boolean" } }),
  async run(p, ctx) {
    const script = join(ctx.root, "scripts", "validate-cases.mjs");
    if (!existsSync(script)) return fail(EXIT.DATOS, `no existe ${script}`);
    const args = [script];
    for (const k of ["dir", "only"] as const) {
      const v = s(p, k);
      if (v !== undefined) args.push(`--${k}`, v);
    }
    if (b(p, "keep")) args.push("--keep");
    const json = b(p, "json");
    const r = await supervise({
      cmd: process.execPath,
      args,
      cwd: ctx.root,
      env: { PATH: ctx.env["PATH"] ?? "/usr/bin:/bin", HOME: ctx.home },
      timeoutMs: Math.round((n(p, "timeout") ?? 900) * 1000),
      signal: ctx.signal,
      ...(json ? {} : { onStdout: (c: string) => ctx.stdout(c), onStderr: (c: string) => ctx.stderr(c) }),
    });
    const passed = r.outcome === "completed" && r.exitCode === 0;
    const data = { outcome: r.outcome, exitCode: r.exitCode, passed, durationMs: r.durationMs, orphans: r.orphans.length, output: json ? r.stdout + r.stderr : undefined };
    if (r.outcome === "cancelled") return { code: EXIT.INTERRUMPIDO, data, text: "Validación cancelada." };
    if (r.outcome === "timeout") return { code: EXIT.FALLO, data, text: "La validación superó el tiempo límite." };
    return { code: passed ? EXIT.OK : EXIT.FALLO, data, text: passed ? "Casos válidos." : `La validación falló (código ${r.exitCode ?? "?"}).` };
  },
};

// ---------- power ----------
const powerCmd: CommandDef = {
  summary: "Potencia estadística (Monte Carlo) o efecto mínimo detectable",
  usage: "agent-bench power --cases N --reps K [--base-rate 0.7] [--delta 0.1 | (omitir = efecto mínimo detectable)] [--alpha 0.05] [--sims 1000] [--seed 1] [--json]",
  opts: pick(COMMON_OPTS, ["help", "json", "seed"], {
    cases: { kind: "int", min: 1 },
    reps: { kind: "int", min: 1 },
    "base-rate": { kind: "number", min: 0, max: 1 },
    delta: { kind: "number", min: 0, max: 1 },
    alpha: { kind: "number", min: 0.0001, max: 0.5 },
    concentration: { kind: "number", min: 0.1 },
    sims: { kind: "int", min: 1 },
    "max-ms": { kind: "int", min: 1 },
  }),
  async run(p) {
    const nCases = n(p, "cases");
    const reps = n(p, "reps");
    if (nCases === undefined || reps === undefined) throw new UsageError("power requiere --cases y --reps");
    const sims = Math.min(n(p, "sims") ?? 1000, MAX_SIMS);
    const common = {
      nCases,
      reps,
      baseRate: n(p, "base-rate") ?? 0.7,
      ...(n(p, "concentration") !== undefined ? { concentration: n(p, "concentration")! } : {}),
      ...(n(p, "alpha") !== undefined ? { alpha: n(p, "alpha")! } : {}),
    };
    const opts = { seed: n(p, "seed") ?? 1, sims, ...(n(p, "max-ms") !== undefined ? { maxMs: n(p, "max-ms")! } : {}) };
    const delta = n(p, "delta");
    if (delta !== undefined) {
      const r = estimatePower({ ...common, delta }, opts);
      const pw = Number.isFinite(r.power) ? r.power : null;
      return ok(
        { mode: "power", spec: { ...common, delta }, sims: r.simsRun, truncated: r.truncated, power: pw },
        `Potencia para detectar ${(delta * 100).toFixed(1)} pp con ${nCases} casos x ${reps} repeticiones (base ${(common.baseRate * 100).toFixed(0)}%): ${pw === null ? "n/d" : (pw * 100).toFixed(1) + "%"} (${r.simsRun} simulaciones${r.truncated ? ", truncado por tiempo" : ""}).`,
      );
    }
    const r = minimumDetectableEffect(common, opts);
    const lines = r.curve.map((c) => `  ${(c.delta * 100).toFixed(0).padStart(3)} pp -> potencia ${(c.power * 100).toFixed(1)}%`);
    return ok(
      { mode: "mde", spec: common, mde: r.mde, curve: r.curve, simsTotal: r.simsTotal, truncated: r.truncated },
      `Efecto mínimo detectable (potencia >= 80%): ${r.mde === null ? "ninguno en la rejilla; aumenta casos o repeticiones" : (r.mde * 100).toFixed(0) + " pp"}\n${lines.join("\n")}`,
    );
  },
};

// ---------- list ----------
const listCmd: CommandDef = {
  summary: "Lista casos, configuraciones, experimentos o runs",
  usage: "agent-bench list [scenarios|configurations|experiments|runs [EXPERIMENTO]] [--results DIR] [--json]",
  opts: pick(COMMON_OPTS, ["help", "json"], { results: { kind: "string" } }),
  async run(p, ctx) {
    const what = p.positionals[0];
    const kinds = ["scenarios", "configurations", "experiments", "runs"];
    if (what !== undefined && !kinds.includes(what)) throw new UsageError(`list: "${what}" no es válido (usa ${kinds.join(", ")})`);
    const out: Record<string, unknown> = {};
    const lines: string[] = [];
    const want = (k: string): boolean => what === undefined || what === k;
    const detail = what !== undefined;
    if (want("scenarios")) {
      const sc = listScenarios(ctx.root);
      out["scenarios"] = sc.map(({ dir: _d, ...r }) => r);
      lines.push(`Casos: ${sc.length}`);
      if (detail) for (const c of sc) lines.push(`  ${c.id}  [${c.suite}${c.difficulty ? " " + c.difficulty : ""}]`);
    }
    if (want("configurations")) {
      const cf = listConfigurations(ctx.root);
      out["configurations"] = cf.map((c) => ({ id: c.id, name: c.name, runner: c.runner, model: c.model }));
      lines.push(`Configuraciones: ${cf.length}`);
      if (detail) for (const c of cf) lines.push(`  ${c.id}  runner=${c.runner} modelo=${c.model ?? "-"}`);
    }
    if (want("experiments")) {
      const files = listExperimentFiles(ctx.root);
      const rd = resultsDir(p, ctx);
      const stored = existsSync(rd) ? readdirSync(rd, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(rd, d.name, "experiment.jsonl"))).map((d) => d.name) : [];
      out["experiments"] = { definitions: files.map((f) => f.slice(f.lastIndexOf(sep) + 1).replace(/\.json$/, "")), withResults: stored };
      lines.push(`Experimentos definidos: ${files.length}; con resultados: ${stored.length}`);
      if (detail) {
        for (const f of files) lines.push(`  definido: ${f.slice(f.lastIndexOf(sep) + 1)}`);
        for (const e of stored) lines.push(`  con resultados: ${e}`);
      }
    }
    if (what === "runs") {
      const rd = resultsDir(p, ctx);
      if (!existsSync(rd)) return fail(EXIT.DATOS, `no existe el directorio de resultados ${rd}`);
      const store = (await import("../store/index.ts")).openStore(rd);
      try {
        const expId = p.positionals[1];
        const runs = store.queryRuns(expId ? { experimentId: expId } : {});
        out["runs"] = runs.map((r) => ({ runId: r.runId, experimentId: r.experimentId, scenarioId: r.scenarioId, configurationId: r.configurationId, repetition: r.repetition, outcome: r.outcome, success: r.success }));
        lines.push(`Runs: ${runs.length}`);
        for (const r of runs.slice(0, 200)) lines.push(`  ${r.runId.slice(0, 8)}  ${r.scenarioId}  ${r.configurationId}  rep ${r.repetition + 1}  ${r.outcome}  éxito=${r.success === null ? "n/d" : r.success ? "sí" : "no"}`);
        if (runs.length > 200) lines.push(`  ... ${runs.length - 200} más (usa --json)`);
      } finally {
        store.close();
      }
    }
    return ok(out, lines.join("\n"));
  },
};

// ---------- clean ----------
export interface CleanTarget {
  base: string;
  entries: { path: string; ageMin: number; skipped: boolean; inUse?: boolean }[];
}

const FRESH_MIN = 10;

/** mtime máximo de la entrada y de todo su contenido (recursivo, sin seguir enlaces, con tope de entradas). */
export function latestMtimeMs(path: string, maxEntries = 50_000): number {
  let latest = 0;
  let n = 0;
  const walk = (p: string): void => {
    if (n++ > maxEntries) return;
    let st;
    try { st = lstatSync(p); } catch { return; }
    if (st.mtimeMs > latest) latest = st.mtimeMs;
    if (st.isDirectory()) { try { for (const e of readdirSync(p)) walk(join(p, e)); } catch { /* ilegible */ } }
  };
  walk(path);
  return latest;
}

export function cleanTargets(home: string, force: boolean, now = Date.now(), inUse: (path: string) => boolean = procsAlive): CleanTarget[] {
  const out: CleanTarget[] = [];
  for (const sub of ["r", "validate"]) {
    const base = join(home, "ab", sub);
    if (!existsSync(base)) continue;
    const entries = readdirSync(base).map((name) => {
      const path = join(base, name);
      // M5: edad por el mtime MÁS RECIENTE de todo el contenido (escribir dentro de ws/ no cambia el mtime del directorio del run)
      const ageMin = (now - latestMtimeMs(path)) / 60000;
      // un run con procesos vivos que citan su ruta (cmdline, cwd o marca AB_RUN_ROOT) nunca se borra, ni con --force
      const live = inUse(path);
      return { path, ageMin, skipped: live || (!force && ageMin < FRESH_MIN), ...(live ? { inUse: true } : {}) };
    });
    out.push({ base, entries });
  }
  return out;
}

/** true si algún proceso vivo cita la ruta (línea de comandos o entorno) o tiene su cwd dentro. */
export function procsAlive(path: string): boolean {
  let real = path;
  try { real = realpathSync(path); } catch { /* ya no existe */ }
  for (const r of new Set([path, real])) {
    if (procsCiting(r).length > 0 || pidsWithCwdUnder(r).length > 0) return true;
  }
  return false;
}

const cleanCmd: CommandDef = {
  summary: "Borra runs y temporales propios de ~/ab/r y ~/ab/validate",
  usage: `agent-bench clean [--dry-run] [--yes] [--force] [--json]   (omite entradas modificadas hace menos de ${FRESH_MIN} min salvo --force)`,
  opts: pick(COMMON_OPTS, ["help", "json", "dry-run", "yes"], { force: { kind: "boolean" } }),
  async run(p, ctx) {
    const targets = cleanTargets(ctx.home, b(p, "force"));
    const all = targets.flatMap((t) => t.entries);
    const toDelete = all.filter((e) => !e.skipped);
    const data = { dryRun: b(p, "dry-run"), bases: targets.map((t) => t.base), delete: toDelete.map((e) => e.path), skipped: all.filter((e) => e.skipped).map((e) => e.path), deleted: [] as string[] };
    const listing = [...toDelete.map((e) => `  borrar: ${e.path}`), ...all.filter((e) => e.skipped).map((e) => `  omitido (${e.inUse ? "procesos vivos lo usan" : "reciente, podría estar en uso"}): ${e.path}`)].join("\n");
    if (toDelete.length === 0) return ok(data, all.length ? `Nada que borrar.\n${listing}` : "Nada que borrar: ~/ab/r y ~/ab/validate están vacíos o no existen.");
    if (b(p, "dry-run")) return ok(data, `Simulación (no se borra nada). Se borrarían ${toDelete.length} entradas:\n${listing}`);
    if (!b(p, "yes")) {
      if (!ctx.isTTY) return fail(EXIT.USO, "clean necesita confirmación: usa --yes (o --dry-run para ver qué borraría)", data);
      ctx.stderr(`Se borrarán ${toDelete.length} entradas:\n${listing}\n`);
      if (!(await ctx.confirm("¿Continuar?"))) return { code: EXIT.OK, data, text: "Cancelado, no se borró nada." };
    }
    for (const t of targets) {
      const realBase = realpathSync(t.base);
      for (const e of t.entries) {
        if (e.skipped) continue;
        // Defensa: solo hijos directos de la base, sin seguir enlaces simbólicos fuera de ella.
        const st = lstatSync(e.path);
        if (!st.isSymbolicLink()) {
          const real = realpathSync(e.path);
          if (!real.startsWith(realBase + sep)) continue;
        }
        rmSync(e.path, { recursive: true, force: true });
        data.deleted.push(e.path);
      }
    }
    return ok(data, `Borradas ${data.deleted.length} entradas.`);
  },
};

// ---------- plan / run ----------
const EXP_OPTS = (extra: OptTable = {}): OptTable =>
  pick(COMMON_OPTS, ["help", "json", "dry-run", "max-cost", "max-concurrency", "max-runs", "max-wall", "timeout", "seed", "out"], { results: { kind: "string" }, ...extra });

interface Prepared {
  experiment: ReturnType<typeof loadExperiment>;
  configurations: ReturnType<typeof listConfigurations>;
  totalRuns: number;
  effectiveRuns: number;
  concurrency: number;
  realRunners: string[];
}

function prepare(p: Parsed, ctx: Ctx): Prepared | CmdResult {
  const ref = p.positionals[0];
  if (!ref) throw new UsageError("falta el experimento (id en experiments/ o ruta a .json)");
  if (p.positionals.length > 1) throw new UsageError(`sobran argumentos: ${p.positionals.slice(1).join(" ")}`);
  const conc = n(p, "max-concurrency");
  if (conc !== undefined && conc > MAX_CONCURRENCY) {
    return fail(EXIT.RECHAZADO, `--max-concurrency ${conc} supera el tope duro de ${MAX_CONCURRENCY}`);
  }
  const experiment = loadExperiment(ctx.root, ref, { maxCost: n(p, "max-cost"), seed: n(p, "seed"), timeoutSec: n(p, "timeout"), maxRuns: n(p, "max-runs"), maxWallSec: n(p, "max-wall"), concurrency: conc });
  const all = listConfigurations(ctx.root);
  const missingCfg = experiment.configurations.filter((id) => !all.some((c) => c.id === id));
  if (missingCfg.length) return fail(EXIT.DATOS, `configuraciones inexistentes: ${missingCfg.join(", ")}`);
  const known = listScenarios(ctx.root);
  const missingSc = experiment.scenarios.filter((id) => !known.some((c) => c.id === id));
  if (missingSc.length) return fail(EXIT.DATOS, `casos inexistentes: ${missingSc.join(", ")}`);
  const configurations = experiment.configurations.map((id) => all.find((c) => c.id === id)!);
  const totalRuns = experiment.scenarios.length * experiment.configurations.length * experiment.repetitions;
  const effectiveRuns = Math.min(totalRuns, experiment.budget.maxRuns ?? totalRuns);
  const realRunners = [...new Set(configurations.map((c) => c.runner).filter((r) => r !== "fake"))];
  return { experiment, configurations, totalRuns, effectiveRuns, concurrency: experiment.concurrency, realRunners };
}

const isResult = (x: Prepared | CmdResult): x is CmdResult => "code" in x;

function summaryText(pr: Prepared): string {
  const e = pr.experiment;
  return [
    `Experimento ${e.id}: ${e.scenarios.length} casos x ${e.configurations.length} configuraciones x ${e.repetitions} repeticiones = ${pr.totalRuns} runs` + (pr.effectiveRuns < pr.totalRuns ? ` (limitado a ${pr.effectiveRuns} por --max-runs)` : ""),
    `Diseño ${e.design}, semilla ${e.seed}, concurrencia ${pr.concurrency}, tope por run ${e.limits.timeoutSec}s`,
    `Presupuesto: coste <= ${e.budget.maxCost} USD, runs <= ${e.budget.maxRuns ?? "sin tope"}, tiempo <= ${e.budget.maxWallSec === null ? "sin tope" : e.budget.maxWallSec + "s"}`,
    `Runners: ${[...new Set(pr.configurations.map((c) => c.runner))].join(", ")}`,
  ].join("\n");
}

const summaryData = (pr: Prepared): Record<string, unknown> => ({
  experimentId: pr.experiment.id,
  scenarios: pr.experiment.scenarios.length,
  configurations: pr.experiment.configurations.length,
  repetitions: pr.experiment.repetitions,
  totalRuns: pr.totalRuns,
  effectiveRuns: pr.effectiveRuns,
  seed: pr.experiment.seed,
  design: pr.experiment.design,
  concurrency: pr.concurrency,
  budget: pr.experiment.budget,
  limits: pr.experiment.limits,
  runners: pr.configurations.map((c) => c.runner),
});

const planCmd: CommandDef = {
  summary: "Muestra el plan de ejecución (orden de runs y estimación) sin ejecutar nada",
  usage: "agent-bench plan EXPERIMENTO [--dry-run] [--seed N] [--max-runs N] [--json]   (plan nunca ejecuta; --dry-run se acepta por simetría con run)",
  opts: EXP_OPTS(),
  async run(p, ctx) {
    const pr = prepare(p, ctx);
    if (isResult(pr)) return pr;
    const data = summaryData(pr);
    const plan = await planFor(pr.experiment, pr.configurations);
    const runs = plan.runs.slice(0, pr.effectiveRuns).map((r) => ({ order: r.index, ...r }));
    const head = runs.slice(0, 20).map((r) => `  ${String(r.order + 1).padStart(4)}. ${r.scenarioId}  ${r.configurationId}  rep ${r.repetition + 1}`);
    const e = plan.estimate;
    const est = `Estimación: ${e.tokensPerRun} tokens/run (${e.tokensBasis === "history" ? "historial" : "supuesto"}), ~${e.secPerRun} s/run, tiempo total ~${e.wallSecTotal} s, coste ${e.costUsdTotal === null ? "n/d" : e.costUsdTotal.toFixed(2) + " USD"}`;
    const warn = plan.warnings.map((w) => `  aviso: ${w}`);
    return ok(
      { ...data, engine: "ok", plan: { ...plan, runs }, estimate: e, warnings: plan.warnings },
      [summaryText(pr), est, ...warn, `Orden (primeros ${head.length} de ${runs.length}):`, ...head].join("\n"),
    );
  },
};

const runCmd: CommandDef = {
  summary: "Ejecuta un experimento (exige --max-cost; solo runner fake por defecto)",
  usage: "agent-bench run EXPERIMENTO --max-cost USD [--dry-run] [--max-concurrency 1|2] [--max-runs N] [--max-wall SEG] [--timeout SEG] [--seed N] [--results DIR | --out DIR] [--allow-real-runner] [--json]",
  opts: EXP_OPTS({ "allow-real-runner": { kind: "boolean" } }),
  async run(p, ctx) {
    if (n(p, "max-cost") === undefined) {
      return fail(EXIT.RECHAZADO, "run exige --max-cost USD (tope de gasto obligatorio). Ejemplo: --max-cost 0 para el runner fake");
    }
    const pr = prepare(p, ctx);
    if (isResult(pr)) return pr;
    let allowReal = false;
    if (pr.realRunners.length) {
      if (!b(p, "allow-real-runner")) {
        return fail(EXIT.RECHAZADO, `las configuraciones usan runners reales (${pr.realRunners.join(", ")}); sin --allow-real-runner solo se permite "fake"`);
      }
      if (ctx.env["AGENT_BENCH_CONFIRM_REAL"] !== "yes") {
        return fail(EXIT.RECHAZADO, "runner real: falta confirmar con la variable de entorno AGENT_BENCH_CONFIRM_REAL=yes");
      }
      const known = ["opencode", "codex"];
      const unknown = pr.realRunners.filter((r) => !known.includes(r));
      if (unknown.length) return fail(EXIT.DATOS, `runner desconocido: ${unknown.join(", ")} (disponibles: fake, opencode, codex)`);
      if (!b(p, "dry-run")) {
        // Aislamiento obligatorio para runners reales: sandbox-exec presente y sin configuración gestionada.
        const d = doctor({});
        const bad = d.checks.filter((c) => (c.name === "sandbox-exec" || c.name === "config-gestionada" || c.name === "node" || c.name === "git") && c.status === "fail");
        if (bad.length) return fail(EXIT.RECHAZADO, `runner real: el entorno no cumple el aislamiento (${bad.map((c) => `${c.name}: ${c.detail}`).join("; ")})`);
      }
      allowReal = true;
    }
    const data = { ...summaryData(pr), allowRealRunner: allowReal };
    const dryRun = b(p, "dry-run");
    const rd = s(p, "out") ?? s(p, "results") ?? join(ctx.root, "results");
    const json = b(p, "json");
    const say = (m: string): void => {
      if (!json) ctx.stderr(m + "\n");
    };
    if (dryRun) {
      const plan = await planFor(pr.experiment, pr.configurations);
      const e = plan.estimate;
      return ok(
        { ...data, dryRun: true, estimate: e, warnings: plan.warnings },
        `Simulación (no se ejecuta nada).\n${summaryText(pr)}\nCoste estimado: ${e.costUsdTotal === null ? "n/d" : e.costUsdTotal.toFixed(2) + " USD"}; runs planificados: ${Math.min(plan.runs.length, pr.effectiveRuns)}.${plan.warnings.map((w) => "\n  aviso: " + w).join("")}`,
      );
    }
    let sum;
    try {
      sum = await runFor({
        experiment: pr.experiment,
        configurations: pr.configurations,
        root: ctx.root,
        resultsDir: rd,
        runBase: join(ctx.home, "ab", "r"),
        allowReal,
        signal: ctx.signal,
        onEvent: (e) => {
          if (e.type === "start") say(`Inicio ${e.experimentId}: ${e.runs} runs (${e.skipped} ya hechos)`);
          else if (e.type === "run-end") say(`  fin ${e.key.slice(0, 8)} ${e.outcome} éxito=${e.success === null ? "n/d" : e.success ? "sí" : "no"}${e.attempt > 1 ? ` (intento ${e.attempt})` : ""}`);
          else if (e.type === "retry") say(`  reintento ${e.attempt} en ${e.delayMs} ms`);
          else if (e.type === "gate-pause") say(`  pausa por carga: ${e.reason}`);
          else if (e.type === "stop") say(`  parada (${e.reason}): ${e.detail}`);
        },
      });
    } catch (e) {
      if (e instanceof ConfigError || e instanceof BudgetError) return fail(EXIT.DATOS, e.message, data);
      throw e;
    }
    const results = sum.results;
    const orphans = results.reduce((a, r) => a + (r.orphans ?? 0), 0);
    const out = {
      ...data,
      status: sum.status,
      stopReason: sum.stopReason,
      stopDetail: sum.stopDetail,
      refusal: sum.refusal,
      runsPlanned: sum.plan.runs.length,
      runsFinished: results.length,
      runsSucceeded: results.filter((r) => r.success === true).length,
      skipped: sum.skipped,
      pending: sum.pending,
      attempts: sum.attempts,
      retries: sum.retries,
      spentUsd: sum.spentUsd,
      costUnknownRuns: sum.costUnknownRuns,
      wallMs: sum.wallMs,
      orphans,
      resultsDir: rd,
      estimate: sum.plan.estimate,
    };
    if (sum.status === "refused") return { code: EXIT.RECHAZADO, data: out, text: `Error: el motor rechazó el experimento: ${sum.refusal}` };
    const code =
      sum.status === "cancelled" ? EXIT.INTERRUMPIDO
      : orphans > 0 || (sum.status === "stopped" && ["damage", "infra_errors", "load_gate"].includes(sum.stopReason ?? "")) ? EXIT.FALLO
      : EXIT.OK;
    // El motor marca "stopped" si el tope de intentos coincide con el plan; sin pendientes es un fin normal.
    const finished = sum.status === "completed" || (sum.pending === 0 && sum.stopReason === "budget_runs");
    const stop = finished ? "completado" : `${sum.status}${sum.stopReason ? ` por ${sum.stopReason}` : ""}`;
    return {
      code,
      data: out,
      text: `Terminado (${stop}): ${out.runsFinished}/${out.runsPlanned} runs (${sum.skipped} reanudados, ${sum.pending} pendientes), ${out.runsSucceeded} con éxito, coste ${sum.costUnknownRuns === results.length ? "n/d (el runner no lo informa)" : sum.spentUsd + " USD"}, huérfanos ${orphans}.\nResultados: ${rd}/${pr.experiment.id}`,
    };
  },
};

// ---------- compare / report ----------
const REPORT_OPTS = (extra: OptTable = {}): OptTable =>
  pick(COMMON_OPTS, ["help", "json", "seed", "out"], {
    results: { kind: "string" },
    input: { kind: "string" },
    experiment: { kind: "string" },
    baseline: { kind: "string" },
    alpha: { kind: "number", min: 0.0001, max: 0.5 },
    boot: { kind: "int", min: 1 },
    composite: { kind: "boolean" },
    ...extra,
  });

const expRef = (p: Parsed): string | undefined => p.positionals[0] ?? s(p, "experiment");
const reportsDir = (p: Parsed, ctx: Ctx): string => s(p, "results") ?? s(p, "input") ?? join(ctx.root, "results");

async function loadRuns(p: Parsed, ctx: Ctx) {
  const exp = expRef(p);
  if (!exp) throw new UsageError("falta el id del experimento (posicional o --experiment)");
  const rd = reportsDir(p, ctx);
  if (!existsSync(rd) || !statSync(rd).isDirectory()) return fail(EXIT.DATOS, `no existe el directorio de resultados ${rd}`);
  const store = (await import("../store/index.ts")).openStore(rd);
  try {
    const runs = store.loadRuns(exp);
    if (runs.length === 0) return fail(EXIT.DATOS, `el experimento "${exp}" no tiene runs en ${rd}`);
    return { exp, runs, rd };
  } finally {
    store.close();
  }
}

const reportReq = (p: Parsed) => ({
  ...(s(p, "baseline") !== undefined ? { baselineId: s(p, "baseline")! } : {}),
  ...(n(p, "alpha") !== undefined ? { alpha: n(p, "alpha")! } : {}),
  ...(n(p, "seed") !== undefined ? { seed: n(p, "seed")! } : {}),
  ...(n(p, "boot") !== undefined ? { boot: n(p, "boot")! } : {}),
  ...(b(p, "composite") ? { composite: true } : {}),
});

const compareCmd: CommandDef = {
  summary: "Compara configuraciones de un experimento (tabla en pantalla)",
  usage: "agent-bench compare EXPERIMENTO [--baseline CONFIG] [--alpha 0.05] [--seed N] [--boot N] [--results DIR] [--json]",
  opts: REPORT_OPTS(),
  async run(p, ctx) {
    const l = await loadRuns(p, ctx);
    if ("code" in l) return l;
    const rep = await loadReport();
    const a = rep.summarize({ runs: l.runs, ...reportReq(p) });
    const pct = (v: number | null): string => (v === null ? "n/d" : (v * 100).toFixed(1) + "%");
    const num = (v: number | null): string => (v === null ? "n/d" : Math.round(v).toString());
    const rows = a.rows.map((r) => `  ${r.configId.padEnd(28)} éxito ${pct(r.successRate).padStart(7)}  tokens(med) ${num(r.tokensMedian).padStart(9)}  duración(med) ${num(r.durationMedianMs).padStart(8)} ms${r.configId === a.baselineId ? "  [base]" : ""}`);
    const cmp = a.comparisons.map((c) => `  ${c.candidateId} frente a ${a.baselineId}: ITT ${c.itt ?? "n/d"}, PP ${c.pp ?? "n/d"}`);
    const warn = a.warnings.map((w) => `  aviso: ${w}`);
    return ok(
      { experimentId: l.exp, ...a },
      [`Experimento ${l.exp}: ${a.runs} runs, ${a.cases} casos, ${a.configs} configuraciones`, ...rows, ...(cmp.length ? ["Veredictos:", ...cmp] : []), ...warn].join("\n"),
    );
  },
};

const reportCmd: CommandDef = {
  summary: "Genera el informe (analysis.json, claims.json, report.html, report.md) o verifica una afirmación",
  usage:
    "agent-bench report EXPERIMENTO [--out DIR] [--baseline CONFIG] [--alpha 0.05] [--seed N] [--boot N] [--composite] [--results DIR] [--json]\n" +
    "       agent-bench report EXPERIMENTO --verify-claim ID|all [--claims claims.json] [--results DIR]   (recomputa desde los runs y compara; 0 = reproducible, 1 = difiere)\n" +
    "       --input DIR y --experiment ID equivalen a --results DIR y al posicional (así los comandos de claims.json son ejecutables)",
  opts: REPORT_OPTS({ "dry-run": { kind: "boolean" }, "verify-claim": { kind: "string" }, claims: { kind: "string" } }),
  async run(p, ctx) {
    const l = await loadRuns(p, ctx);
    if ("code" in l) return l;
    const outDir = s(p, "out") ?? join(l.rd, l.exp, "report");
    const verify = s(p, "verify-claim");
    if (verify !== undefined) {
      const claimsPath = s(p, "claims") ?? join(outDir, "claims.json");
      if (!existsSync(claimsPath)) return fail(EXIT.DATOS, `no existe ${claimsPath}: genera primero el informe con "report ${l.exp}"`);
      let file: ClaimsFile;
      try {
        file = JSON.parse(readFileSync(claimsPath, "utf8")) as ClaimsFile;
      } catch (e) {
        return fail(EXIT.DATOS, `no se pudo leer ${claimsPath}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (!Array.isArray(file.claims)) return fail(EXIT.DATOS, `${claimsPath} no es un claims.json válido`);
      const chosen = verify === "all" ? file.claims : file.claims.filter((c) => c.id === verify);
      if (chosen.length === 0) return fail(EXIT.DATOS, `la afirmación "${verify}" no existe en ${claimsPath}`);
      // Opciones del análisis: las de analysis.json (si existe) y, encima, las flags explícitas.
      const apath = join(dirname(claimsPath), "analysis.json");
      let saved: { baselineId?: string; alpha?: number; seed?: number; B?: number; composite?: boolean } = {};
      if (existsSync(apath)) {
        try {
          saved = (JSON.parse(readFileSync(apath, "utf8")) as { options?: typeof saved }).options ?? {};
        } catch {
          /* se usan los valores por defecto */
        }
      }
      const req = {
        ...(saved.baselineId !== undefined ? { baselineId: saved.baselineId } : {}),
        ...(saved.alpha !== undefined ? { alpha: saved.alpha } : {}),
        ...(saved.seed !== undefined ? { seed: saved.seed } : {}),
        ...(saved.B !== undefined ? { boot: saved.B } : {}),
        ...(saved.composite ? { composite: true } : {}),
        ...reportReq(p),
      };
      const rep = await loadReport();
      const r = rep.verify(l.runs, { ...file, claims: chosen }, req);
      const lines = chosen.map((c) => `  ${r.mismatches.some((m) => m.startsWith(c.id + ":") || m.startsWith(c.id + " ")) ? "DIFIERE" : "ok     "} ${c.id} = ${String(c.value)}  (${c.text})`);
      return {
        code: r.ok ? EXIT.OK : EXIT.FALLO,
        data: { experimentId: l.exp, verified: chosen.length, reproducible: r.ok, mismatches: r.mismatches, claimsPath },
        text: `${r.ok ? "Reproducible" : "NO reproducible"}: ${chosen.length} afirmación(es) recomputadas desde ${l.runs.length} runs.\n${lines.join("\n")}${r.mismatches.length ? "\nDiferencias:\n" + r.mismatches.map((m) => "  " + m).join("\n") : ""}`,
      };
    }
    if (b(p, "dry-run")) return ok({ dryRun: true, outDir, runs: l.runs.length }, `Simulación: se escribiría el informe de ${l.runs.length} runs en ${outDir}`);
    const rep = await loadReport();
    const r = rep.write({ runs: l.runs, outDir, title: l.exp, inputRef: `${l.rd} --experiment ${l.exp}`, ...reportReq(p) });
    return ok({ outDir, files: r.files, runs: l.runs.length }, `Informe escrito en ${outDir}:\n${r.files.map((f) => "  " + f).join("\n")}`);
  },
};

export const COMMANDS: Record<string, CommandDef> = {
  doctor: doctorCmd,
  "validate-cases": validateCmd,
  power: powerCmd,
  list: listCmd,
  clean: cleanCmd,
  plan: planCmd,
  run: runCmd,
  compare: compareCmd,
  report: reportCmd,
};

export { DataError, UsageError };
