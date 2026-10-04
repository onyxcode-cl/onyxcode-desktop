// Generador de analysis.json y claims.json a partir de RunResult[].
import { canonicalJson, contentHash } from "../core/ids.ts";
import type { RunResult } from "../core/schemas.ts";
import {
  MPE_DEFAULT, applyPolicy, compareConfigs, estimatePower, quantileSorted, summarizeConfig, wilson,
} from "../stats/index.ts";
import type { MetricName, RunRow } from "../stats/index.ts";
import type {
  Analysis, CatastropheStats, Claim, ClaimsFile, ComparisonReport, CompositeEntry, ConfigReport, Dist, PowerWarning,
  ReportOptions, StabilityRow,
} from "./types.ts";

export const REPORT_DATA_VERSION = "runresult-v1";
const CATASTROPHE_KINDS = new Set(["anti-cheat", "restrictions", "fs_diff", "canary", "escalation"]);

export function toRow(r: RunResult): RunRow {
  return {
    caseId: r.scenarioId,
    configId: r.configurationId,
    success: r.success,
    tokens: r.telemetry.totalTokens,
    durationMs: r.durationMs,
    outcome: r.outcome,
    rep: r.repetition,
  };
}

/** Hash estable de los datos de entrada (independiente del orden del arreglo). */
export function hashRuns(runs: readonly RunResult[]): string {
  const sorted = [...runs].map((r) => canonicalJson(r)).sort();
  return contentHash(sorted.join("\n"));
}

/** Catástrofe: violación de evaluadores de seguridad/restricciones, run colgado o procesos huérfanos. */
export function catastropheReasons(r: RunResult): string[] {
  const out: string[] = [];
  for (const e of r.evaluators) {
    if (CATASTROPHE_KINDS.has(e.kind) && (e.passed === false || e.violations.length > 0)) out.push(e.kind);
  }
  if (r.outcome === "hung") out.push("hung");
  if (r.orphans !== null && r.orphans > 0) out.push("orphans");
  return out;
}

/** Sustituye NaN/Infinity/undefined por null de forma recursiva. */
export function jsonSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "number" && !Number.isFinite(x) ? null : x))) as T;
}

function dist(vals: (number | null)[]): Dist {
  const v = vals.filter((x): x is number => x !== null && Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (!v.length) return { n: 0, nulls: vals.length, min: null, q1: null, median: null, q3: null, max: null };
  return {
    n: v.length, nulls: vals.length - v.length, min: v[0]!, q1: quantileSorted(v, 0.25), median: quantileSorted(v, 0.5),
    q3: quantileSorted(v, 0.75), max: v[v.length - 1]!,
  };
}

function catastrophe(configId: string, rs: readonly RunResult[], alpha: number): CatastropheStats {
  const reasons: Record<string, number> = {};
  let c = 0;
  for (const r of rs) {
    const why = catastropheReasons(r);
    if (why.length) c++;
    for (const w of new Set(why)) reasons[w] = (reasons[w] ?? 0) + 1;
  }
  const w = wilson(c, rs.length, alpha);
  return { configId, runs: rs.length, catastrophes: c, rate: rs.length ? c / rs.length : null, wilson: { lo: w.lo, hi: w.hi }, reasons };
}

function paretoFront(points: { id: string; cost: number | null; rate: number }[]): Set<string> {
  const pts = points.filter((p) => p.cost !== null && Number.isFinite(p.rate));
  const front = new Set<string>();
  for (const p of pts) {
    const dominated = pts.some((q) => q !== p && q.rate >= p.rate && q.cost! <= p.cost! && (q.rate > p.rate || q.cost! < p.cost!));
    if (!dominated) front.add(p.id);
  }
  return front;
}

const W = { success: 0.6, tokens: 0.2, duration: 0.2 };

export function analyze(input: readonly RunResult[], opts: ReportOptions = {}): Analysis {
  // Orden canónico: el resultado no depende del orden de entrada (suma en coma flotante estable).
  const key = (r: RunResult) => r.scenarioId + "|" + r.configurationId + "|" + String(r.repetition).padStart(8, "0") + "|" + r.runId;
  const runs = [...input].sort((a, b) => key(a).localeCompare(key(b)));
  const rows = runs.map(toRow);
  const ids = [...new Set(rows.map((r) => r.configId))].sort();
  if (!ids.length) throw new Error("analyze: sin runs");
  const baselineId = opts.baselineId ?? ids[0]!;
  if (!ids.includes(baselineId)) throw new Error(`analyze: baseline desconocida: ${baselineId}`);
  const alpha = opts.alpha ?? 0.05;
  const seed = opts.seed ?? 1;
  const B = opts.B ?? 2000;
  const mpe = opts.mpe ?? MPE_DEFAULT;
  const ao = { alpha, seed, B, mpe };
  const dataHash = hashRuns(runs);
  const cases = [...new Set(rows.map((r) => r.caseId))].sort();

  const configs: ConfigReport[] = ids.map((id) => {
    const rs = runs.filter((r) => r.configurationId === id);
    const costs = rs.map((r) => r.telemetry.costUsd);
    const allCost = rs.length > 0 && costs.every((c) => c !== null);
    return {
      configId: id,
      label: id,
      itt: summarizeConfig(rows, id, "ITT", ao),
      pp: summarizeConfig(rows, id, "PP", ao),
      tokens: dist(rs.map((r) => r.telemetry.totalTokens)),
      duration: dist(rs.map((r) => r.durationMs)),
      costUsdMean: allCost ? costs.reduce((a, c) => a + c!, 0) / rs.length : null,
      catastrophe: catastrophe(id, rs, alpha),
      onParetoFront: false,
    };
  });
  const useUsd = configs.every((c) => c.costUsdMean !== null);
  const front = paretoFront(configs.map((c) => ({
    id: c.configId, rate: c.itt.rate,
    cost: useUsd ? c.costUsdMean : Number.isFinite(c.itt.tokens.geoMean) ? c.itt.tokens.geoMean : null,
  })));
  for (const c of configs) c.onParetoFront = front.has(c.configId);

  const comparisons: ComparisonReport[] = [];
  for (const id of ids.filter((x) => x !== baselineId)) {
    const comparison = compareConfigs(rows, baselineId, id, ao);
    const cid = `${baselineId}__vs__${id}`;
    const warnings: PowerWarning[] = [];
    for (const [pol, pc] of [["ITT", comparison.itt], ["PP", comparison.pp]] as const) {
      for (const m of ["success", "tokens", "duration"] as MetricName[]) {
        const mc = pc.metrics[m];
        if (!mc) continue;
        if (!mc.decision.powered) {
          warnings.push({ comparison: cid, metric: m, message: `Baja potencia (${pol}, ${m}): efecto mínimo detectable ${mc.decision.mde.toFixed(3)} mayor que el efecto práctico mínimo ${mc.decision.margin.toFixed(3)}; un resultado nulo no prueba equivalencia.` });
        }
      }
    }
    if (comparison.policiesDisagree) {
      warnings.push({ comparison: cid, metric: "success", message: `ITT (${comparison.itt.overall}) y PP (${comparison.pp.overall}) discrepan: la conclusión depende de los runs de infraestructura.` });
    }
    const nC = comparison.itt.metrics.success?.nCases ?? 0;
    const reps = nC ? Math.round(rows.filter((r) => r.configId === id).length / nC) : 0;
    let power: ComparisonReport["power"] = null;
    if (nC > 0 && reps > 0) {
      const base = configs.find((c) => c.configId === baselineId)!.itt.rate;
      const p = estimatePower({ nCases: nC, reps, baseRate: Math.min(Math.max(base, 0.05), 0.95), delta: mpe.success, alpha }, { seed, sims: opts.powerSims ?? 300, maxMs: 10_000 });
      power = { power: p.power, simsRun: p.simsRun, truncated: p.truncated, nCases: nC, repsPerCase: reps, deltaMpe: mpe.success };
      if (Number.isFinite(p.power) && p.power < 0.8) {
        warnings.push({ comparison: cid, metric: "success-power", message: `Potencia estimada ${(p.power * 100).toFixed(0)} % para detectar ${(mpe.success * 100).toFixed(0)} pp de éxito con ${nC} casos x ${reps} repeticiones (objetivo 80 %).` });
      }
    }
    comparisons.push({ id: cid, comparison, power, warnings });
  }

  const stability: StabilityRow[] = cases.map((caseId) => {
    const cells: StabilityRow["cells"] = {};
    for (const id of ids) {
      const rs = rows.filter((r) => r.caseId === caseId && r.configId === id);
      const s = rs.filter((r) => r.outcome === "completed" && r.success === true).length;
      cells[id] = { state: !rs.length ? "sin datos" : s === rs.length ? "siempre" : s === 0 ? "nunca" : "a veces", successes: s, runs: rs.length };
    }
    return { caseId, cells };
  });

  let composite: Analysis["composite"] = null;
  if (opts.composite) {
    const base = configs.find((c) => c.configId === baselineId)!;
    const entries: CompositeEntry[] = configs.map((c) => {
      const comps = {
        success: Number.isFinite(c.itt.rate) ? c.itt.rate : null,
        tokens: ratioScore(base.itt.tokens.geoMean, c.itt.tokens.geoMean),
        duration: ratioScore(base.itt.duration.geoMean, c.itt.duration.geoMean),
      };
      return {
        configId: c.configId,
        score: compositeOf(comps),
        components: comps,
        regressions: comparisons.filter((x) => x.comparison.candidateId === c.configId).flatMap((x) =>
          (["itt", "pp"] as const).flatMap((p) => Object.values(x.comparison[p].metrics).filter((m) => m!.decision.veredicto === "PEOR-REGRESIÓN").map((m) => `${p.toUpperCase()}:${m!.metric}`))),
      };
    });
    composite = {
      enabled: true, weights: W, entries,
      note: "Score compuesto opcional; no sustituye a los datos originales. Las regresiones se listan siempre junto al score.",
    };
  }

  const warnings = [
    ...comparisons.flatMap((c) => c.warnings.map((w) => w.message)),
    ...configs.filter((c) => c.itt.tokens.nulls > 0).map((c) => `${c.configId}: ${c.itt.tokens.nulls} runs sin tokens declarados (null, no 0).`),
  ];

  return jsonSafe({
    schemaVersion: "1" as const,
    title: opts.title ?? "Informe agent-bench",
    data: { runs: runs.length, dataHash, dataVersion: REPORT_DATA_VERSION, cases: cases.length, configs: ids.length },
    options: { baselineId, alpha, seed, B, mpe, composite: !!opts.composite },
    configs, comparisons, stability, composite, warnings,
  });
}

/** Razón base/candidato acotada a [0,1]: 0.5 = igual, 1 = la mitad o menos de coste. */
function ratioScore(base: number, cand: number): number | null {
  if (!Number.isFinite(base) || !Number.isFinite(cand) || base <= 0 || cand <= 0) return null;
  const lr = Math.log(base / cand);
  return 1 / (1 + Math.exp(-2 * lr));
}

function compositeOf(c: { success: number | null; tokens: number | null; duration: number | null }): number | null {
  if (c.success === null) return null;
  let s = W.success * c.success;
  let w = W.success;
  for (const k of ["tokens", "duration"] as const) {
    if (c[k] !== null) { s += W[k] * c[k]!; w += W[k]; }
  }
  return s / w;
}

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o === null || o === undefined ? undefined : (o as Record<string, unknown>)[k]), obj);
}
export function resolvePath(analysis: Analysis, path: string): unknown {
  return get(analysis, path);
}

export function buildClaims(a: Analysis, opts: ReportOptions = {}): ClaimsFile {
  const input = opts.inputRef ?? "results/runs.jsonl";
  const { dataHash, dataVersion } = a.data;
  const cmd = (id: string) =>
    `node bin/agent-bench.ts report --input ${input} --baseline ${a.options.baselineId} --seed ${a.options.seed} --boot ${a.options.B} --alpha ${a.options.alpha}${a.options.composite ? " --composite" : ""} --verify-claim ${id}`;
  const claims: Claim[] = [];
  const add = (id: string, text: string, path: string) => {
    const v = get(a, path);
    const value = typeof v === "number" || typeof v === "string" || typeof v === "boolean" ? v : null;
    claims.push({ id, text, value, path, command: cmd(id), dataHash, dataVersion });
  };
  a.configs.forEach((c, i) => {
    add(`rate.${c.configId}`, `Tasa de éxito (ITT) de ${c.configId}: ${c.itt.successes}/${c.itt.runs}`, `configs.${i}.itt.rate`);
    add(`catastrophe.${c.configId}`, `Tasa de catástrofes de ${c.configId}`, `configs.${i}.catastrophe.rate`);
  });
  a.comparisons.forEach((c, i) => {
    for (const p of ["itt", "pp"] as const) {
      add(`verdict.${c.id}.${p}`, `Veredicto global ${p.toUpperCase()} de ${c.comparison.candidateId} frente a ${c.comparison.baselineId}`, `comparisons.${i}.comparison.${p}.overall`);
      for (const m of Object.keys(c.comparison[p].metrics)) {
        const mc = c.comparison[p].metrics[m as MetricName]!;
        add(`delta.${c.id}.${p}.${m}`, `Efecto en ${m} (${p.toUpperCase()}) de ${c.comparison.candidateId} frente a ${c.comparison.baselineId}, escala ${mc.scale}`, `comparisons.${i}.comparison.${p}.metrics.${m}.delta`);
        add(`verdict.${c.id}.${p}.${m}`, `Veredicto de ${m} (${p.toUpperCase()}) de ${c.comparison.candidateId}`, `comparisons.${i}.comparison.${p}.metrics.${m}.decision.veredicto`);
      }
    }
  });
  return { schemaVersion: "1", dataHash, dataVersion, claims };
}

/** Verifica que cada afirmación sea reproducible: recomputa desde los runs y compara valor y hash. */
export function verifyClaims(runs: readonly RunResult[], file: ClaimsFile, opts: ReportOptions): { ok: boolean; mismatches: string[] } {
  const a = analyze(runs, opts);
  const fresh = buildClaims(a, opts);
  const mismatches: string[] = [];
  if (fresh.dataHash !== file.dataHash) mismatches.push("dataHash distinto");
  const byId = new Map(fresh.claims.map((c) => [c.id, c]));
  for (const c of file.claims) {
    const f = byId.get(c.id);
    if (!f) mismatches.push(`${c.id}: no existe al recomputar`);
    else if (canonicalJson(f.value) !== canonicalJson(c.value)) mismatches.push(`${c.id}: ${String(c.value)} != ${String(f.value)}`);
  }
  return { ok: mismatches.length === 0, mismatches };
}

export { applyPolicy };
