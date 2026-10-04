import { existsSync, lstatSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { doctor } from "../isolation/doctor.ts";
import { estimatePower, minimumDetectableEffect, MAX_SIMS } from "../stats/power.ts";
import { supervise } from "../core/proc.ts";
import { COMMON_OPTS, parseArgs, pick, UsageError, type OptTable, type Parsed } from "./args.ts";
import { EXIT, fail, ok, type CmdResult, type Ctx } from "./ctx.ts";
import { DataError, listConfigurations, listExperimentFiles, listScenarios, loadExperiment } from "./data.ts";
import { loadEngine, loadReport, type RunRequest } from "./wiring.ts";

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
        for (const r of runs.slice(0, 200)) lines.push(`  ${r.runId.slice(0, 8)}  ${r.scenarioId}  ${r.configurationId}  rep ${r.repetition}  ${r.outcome}  éxito=${r.success === null ? "n/d" : r.success ? "sí" : "no"}`);
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
  entries: { path: string; ageMin: number; skipped: boolean }[];
}

const FRESH_MIN = 10;

export function cleanTargets(home: string, force: boolean, now = Date.now()): CleanTarget[] {
  const out: CleanTarget[] = [];
  for (const sub of ["r", "validate"]) {
    const base = join(home, "ab", sub);
    if (!existsSync(base)) continue;
    const entries = readdirSync(base).map((name) => {
      const path = join(base, name);
      const ageMin = (now - lstatSync(path).mtimeMs) / 60000;
      return { path, ageMin, skipped: !force && ageMin < FRESH_MIN };
    });
    out.push({ base, entries });
  }
  return out;
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
    const listing = [...toDelete.map((e) => `  borrar: ${e.path}`), ...all.filter((e) => e.skipped).map((e) => `  omitido (reciente, podría estar en uso): ${e.path}`)].join("\n");
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
  summary: "Muestra el plan de ejecución (orden de runs) sin ejecutar nada",
  usage: "agent-bench plan EXPERIMENTO [--seed N] [--max-runs N] [--json]",
  opts: EXP_OPTS(),
  async run(p, ctx) {
    const pr = prepare(p, ctx);
    if (isResult(pr)) return pr;
    const data = summaryData(pr);
    const eng = await loadEngine(ctx.root);
    if (!eng.ok) return { code: EXIT.NO_DISPONIBLE, data: { ...data, engine: "no disponible", reason: eng.reason }, text: `${summaryText(pr)}\nPlan detallado no disponible: ${eng.reason}.` };
    const plan = await eng.api.plan({ experiment: pr.experiment, configurations: pr.configurations, benchmarksDir: join(ctx.root, "benchmarks") });
    const runs = plan.runs.slice(0, pr.effectiveRuns);
    const head = runs.slice(0, 20).map((r) => `  ${String(r.order + 1).padStart(4)}. ${r.scenarioId}  ${r.configurationId}  rep ${r.repetition}`);
    return ok({ ...data, engine: "ok", plan: { ...plan, runs } }, `${summaryText(pr)}\nOrden (primeros ${head.length} de ${runs.length}):\n${head.join("\n")}`);
  },
};

const runCmd: CommandDef = {
  summary: "Ejecuta un experimento (exige --max-cost; solo runner fake por defecto)",
  usage: "agent-bench run EXPERIMENTO --max-cost USD [--dry-run] [--max-concurrency 1|2] [--max-runs N] [--max-wall SEG] [--timeout SEG] [--seed N] [--out DIR] [--allow-real-runner] [--json]",
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
      allowReal = true;
    }
    const data = { ...summaryData(pr), allowRealRunner: allowReal };
    if (b(p, "dry-run")) return ok({ ...data, dryRun: true }, `Simulación (no se ejecuta nada).\n${summaryText(pr)}`);
    const eng = await loadEngine(ctx.root);
    if (!eng.ok) return { code: EXIT.NO_DISPONIBLE, data: { ...data, engine: "no disponible", reason: eng.reason }, text: `Motor no disponible: ${eng.reason}. No se ejecutó nada.` };
    const req: RunRequest = {
      experiment: pr.experiment,
      configurations: pr.configurations,
      benchmarksDir: join(ctx.root, "benchmarks"),
      resultsDir: s(p, "out") ?? s(p, "results") ?? join(ctx.root, "results"),
      maxCost: pr.experiment.budget.maxCost,
      maxRuns: pr.experiment.budget.maxRuns,
      maxWallSec: pr.experiment.budget.maxWallSec,
      concurrency: Math.min(pr.concurrency, MAX_CONCURRENCY),
      timeoutSec: n(p, "timeout") === undefined ? null : Math.ceil(n(p, "timeout")!),
      allowRealRunner: allowReal,
      signal: ctx.signal,
      ...(b(p, "json") ? {} : { onProgress: (m: string) => ctx.stderr(m + "\n") }),
    };
    const sum = await eng.api.run(req);
    const code = sum.stoppedBy === "cancelled" ? EXIT.INTERRUMPIDO : sum.stoppedBy === "error" || sum.orphans > 0 ? EXIT.FALLO : EXIT.OK;
    return {
      code,
      data: { ...data, summary: sum },
      text: `Terminado (${sum.stoppedBy}): ${sum.runsFinished}/${sum.runsPlanned} runs, ${sum.runsSucceeded} con éxito, coste ${sum.costUsd === null ? "n/d" : sum.costUsd + " USD"}, huérfanos ${sum.orphans}.`,
    };
  },
};

// ---------- compare / report ----------
const REPORT_OPTS = (extra: OptTable = {}): OptTable => pick(COMMON_OPTS, ["help", "json", "seed", "out"], { results: { kind: "string" }, baseline: { kind: "string" }, alpha: { kind: "number", min: 0.0001, max: 0.5 }, ...extra });

async function loadRuns(p: Parsed, ctx: Ctx) {
  const exp = p.positionals[0];
  if (!exp) throw new UsageError("falta el id del experimento");
  const rd = resultsDir(p, ctx);
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
});

const compareCmd: CommandDef = {
  summary: "Compara configuraciones de un experimento (tabla en pantalla)",
  usage: "agent-bench compare EXPERIMENTO [--baseline CONFIG] [--alpha 0.05] [--results DIR] [--json]",
  opts: REPORT_OPTS(),
  async run(p, ctx) {
    const l = await loadRuns(p, ctx);
    if ("code" in l) return l;
    const rep = await loadReport(ctx.root);
    if (!rep.ok) return fail(EXIT.NO_DISPONIBLE, `informes no disponibles: ${rep.reason}`);
    const a = rep.api.summarize({ runs: l.runs, ...reportReq(p) });
    const pct = (v: number | null): string => (v === null ? "n/d" : (v * 100).toFixed(1) + "%");
    const num = (v: number | null): string => (v === null ? "n/d" : Math.round(v).toString());
    const rows = a.rows.map((r) => `  ${r.configId.padEnd(28)} éxito ${pct(r.successRate).padStart(7)}  tokens(med) ${num(r.tokensMedian).padStart(9)}  duración(med) ${num(r.durationMedianMs).padStart(8)} ms${r.configId === a.baselineId ? "  [base]" : ""}`);
    const warn = a.warnings.map((w) => `  aviso: ${w}`);
    return ok({ experimentId: l.exp, ...a }, [`Experimento ${l.exp}: ${a.runs} runs, ${a.cases} casos, ${a.configs} configuraciones`, ...rows, ...warn].join("\n"));
  },
};

const reportCmd: CommandDef = {
  summary: "Genera el informe (analysis.json, claims.json, report.html, report.md)",
  usage: "agent-bench report EXPERIMENTO [--out DIR] [--baseline CONFIG] [--alpha 0.05] [--results DIR] [--json]",
  opts: REPORT_OPTS({ "dry-run": { kind: "boolean" } }),
  async run(p, ctx) {
    const l = await loadRuns(p, ctx);
    if ("code" in l) return l;
    const outDir = s(p, "out") ?? join(l.rd, l.exp, "report");
    if (b(p, "dry-run")) return ok({ dryRun: true, outDir, runs: l.runs.length }, `Simulación: se escribiría el informe de ${l.runs.length} runs en ${outDir}`);
    const rep = await loadReport(ctx.root);
    if (!rep.ok) return fail(EXIT.NO_DISPONIBLE, `informes no disponibles: ${rep.reason}`);
    const r = rep.api.write({ runs: l.runs, outDir, title: l.exp, inputRef: l.rd, ...reportReq(p) });
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
