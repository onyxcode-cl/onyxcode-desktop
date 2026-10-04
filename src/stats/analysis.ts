// Análisis de experimento: ITT vs PP, escala log para tokens/duración, decisión con MPE.
import type { Interval, MetricName, Mpe, Policy, RunOutcome, RunRow, Veredicto } from "./types.ts";
import { MPE_DEFAULT } from "./types.ts";
import { mean } from "./dist.ts";
import { bootstrapClusterMean, bootstrapClusterPooled, wilson } from "./intervals.ts";
import { holm } from "./multiple.ts";
import { mcnemarExact, signFlipTest, wilcoxonSignedRank } from "./tests.ts";
import { coefVar, passKSummary, stability, type CaseCounts, type PassKSummary, type StabilitySummary } from "./reliability.ts";
import { decideMetric, decideOverall, marginFor, type MetricDecision } from "./decision.ts";
import { seedFrom } from "./rng.ts";

/** Resultados que no son "culpa del agente": PP los excluye; ITT los cuenta (como fallo de éxito). */
export const NON_AGENT_OUTCOMES: readonly RunOutcome[] = ["infra_error", "rate_limited", "cancelled"];

export interface AnalysisOptions {
  mpe?: Mpe;
  alpha?: number;
  seed?: number;
  /** Remuestreos bootstrap (tope 50000). */
  B?: number;
  /** Remuestreos Monte Carlo del sign-flip cuando hay > 16 casos con diferencia. */
  nResamples?: number;
  ks?: number[];
}

/** Filas efectivas por política. ITT: todas. PP: sin infra_error/rate_limited/cancelled ni éxito sin evaluar. */
export function applyPolicy(rows: readonly RunRow[], policy: Policy): RunRow[] {
  if (policy === "ITT") return [...rows];
  return rows.filter((r) => !NON_AGENT_OUTCOMES.includes(r.outcome) && !(r.outcome === "completed" && r.success === null));
}

/** Éxito de una fila: ITT cuenta cualquier no-completado o sin evaluar como fallo. */
function isSuccess(r: RunRow): boolean {
  return r.outcome === "completed" && r.success === true;
}

function byCase(rows: readonly RunRow[]): Map<string, RunRow[]> {
  const m = new Map<string, RunRow[]>();
  for (const r of rows) {
    const a = m.get(r.caseId);
    if (a) a.push(r);
    else m.set(r.caseId, [r]);
  }
  return m;
}

/** Valor por caso (media de sus runs) en la escala de análisis; ln para tokens/duración. null/<=0 se ignoran. */
export function perCaseValues(rows: readonly RunRow[], metric: MetricName): Map<string, number> {
  const out = new Map<string, number>();
  for (const [caseId, rs] of byCase(rows)) {
    const vals: number[] = [];
    for (const r of rs) {
      if (metric === "success") vals.push(isSuccess(r) ? 1 : 0);
      else {
        const v = metric === "tokens" ? r.tokens : r.durationMs;
        if (v !== null && Number.isFinite(v) && v > 0) vals.push(Math.log(v));
      }
    }
    if (vals.length) out.set(caseId, mean(vals));
  }
  return out;
}

export interface MetricComparison {
  metric: MetricName;
  scale: "proportion" | "log";
  nCases: number;
  /** Casos presentes en una sola configuración (excluidos del pareo). */
  unpairedCases: number;
  /** Media original: tasa de éxito, o media geométrica de tokens/ms. */
  baseline: number;
  candidate: number;
  /** candidate - baseline en la escala de análisis (proporción o ln ratio). */
  delta: number;
  ci: Interval;
  /** Solo log: razón candidato/base y cambio relativo con su IC. */
  ratio?: number;
  pctChange?: number;
  pctChangeCi?: Interval;
  pSignFlip: number;
  pSignFlipHolm: number;
  pWilcoxon: number;
  mcnemar?: { b: number; c: number; p: number };
  decision: MetricDecision;
}

export interface PolicyComparison {
  policy: Policy;
  metrics: Partial<Record<MetricName, MetricComparison>>;
  overall: Veredicto;
  runsBaseline: number;
  runsCandidate: number;
}

const METRICS: MetricName[] = ["success", "tokens", "duration"];

function compareMetric(a: Map<string, number>, b: Map<string, number>, metric: MetricName, opts: AnalysisOptions, tag: string): Omit<MetricComparison, "pSignFlipHolm"> | null {
  const ids = [...a.keys()].filter((k) => b.has(k)).sort();
  if (ids.length === 0) return null;
  const unpaired = new Set([...a.keys(), ...b.keys()]).size - ids.length;
  const va = ids.map((k) => a.get(k)!);
  const vb = ids.map((k) => b.get(k)!);
  const d = vb.map((x, i) => x - va[i]!);
  const seed = (opts.seed ?? 1) + seedFrom(tag + metric);
  const bo = { seed, ...(opts.B !== undefined ? { B: opts.B } : {}), ...(opts.alpha !== undefined ? { alpha: opts.alpha } : {}) };
  const boot = bootstrapClusterMean(d, bo);
  const sf = signFlipTest(d, { seed, ...(opts.nResamples !== undefined ? { nResamples: opts.nResamples } : {}) });
  const wx = wilcoxonSignedRank(d);
  const log = metric !== "success";
  const margin = marginFor(metric, opts.mpe ?? MPE_DEFAULT);
  const decision = decideMetric({ estimate: boot.estimate, lo: boot.lo, hi: boot.hi, margin, direction: metric === "success" ? 1 : -1, ...(opts.alpha !== undefined ? { alpha: opts.alpha } : {}) });
  const res: Omit<MetricComparison, "pSignFlipHolm"> = {
    metric,
    scale: log ? "log" : "proportion",
    nCases: ids.length,
    unpairedCases: unpaired,
    baseline: log ? Math.exp(mean(va)) : mean(va),
    candidate: log ? Math.exp(mean(vb)) : mean(vb),
    delta: boot.estimate,
    ci: { lo: boot.lo, hi: boot.hi },
    pSignFlip: sf.p,
    pWilcoxon: wx.p,
    decision,
  };
  if (log) {
    res.ratio = Math.exp(boot.estimate);
    res.pctChange = Math.exp(boot.estimate) - 1;
    res.pctChangeCi = { lo: Math.exp(boot.lo) - 1, hi: Math.exp(boot.hi) - 1 };
  } else {
    // McNemar a nivel de caso: un caso "pasa" si su tasa > 0.5.
    let bb = 0;
    let cc = 0;
    for (let i = 0; i < ids.length; i++) {
      const pa = va[i]! > 0.5;
      const pb = vb[i]! > 0.5;
      if (pa && !pb) bb++;
      else if (!pa && pb) cc++;
    }
    const mc = mcnemarExact(bb, cc);
    res.mcnemar = { b: bb, c: cc, p: mc.p };
  }
  return res;
}

export function comparePolicy(rows: readonly RunRow[], baselineId: string, candidateId: string, policy: Policy, opts: AnalysisOptions = {}): PolicyComparison {
  const eff = applyPolicy(rows, policy);
  const A = eff.filter((r) => r.configId === baselineId);
  const B = eff.filter((r) => r.configId === candidateId);
  const tag = `${policy}|${baselineId}|${candidateId}|`;
  const raw: Omit<MetricComparison, "pSignFlipHolm">[] = [];
  for (const m of METRICS) {
    const c = compareMetric(perCaseValues(A, m), perCaseValues(B, m), m, opts, tag);
    if (c) raw.push(c);
  }
  const adj = holm(raw.map((r) => r.pSignFlip));
  const metrics: Partial<Record<MetricName, MetricComparison>> = {};
  raw.forEach((r, i) => {
    metrics[r.metric] = { ...r, pSignFlipHolm: adj[i]! };
  });
  const s = metrics.success?.decision.veredicto ?? "SIN EVIDENCIA";
  const overall = decideOverall({
    success: s,
    ...(metrics.tokens ? { tokens: metrics.tokens.decision.veredicto } : {}),
    ...(metrics.duration ? { duration: metrics.duration.decision.veredicto } : {}),
  });
  return { policy, metrics, overall, runsBaseline: A.length, runsCandidate: B.length };
}

export interface Comparison {
  baselineId: string;
  candidateId: string;
  itt: PolicyComparison;
  pp: PolicyComparison;
  /** true si ITT y PP dan distinto veredicto global: la conclusión es sensible a los runs de infraestructura. */
  policiesDisagree: boolean;
}

export function compareConfigs(rows: readonly RunRow[], baselineId: string, candidateId: string, opts: AnalysisOptions = {}): Comparison {
  const itt = comparePolicy(rows, baselineId, candidateId, "ITT", opts);
  const pp = comparePolicy(rows, baselineId, candidateId, "PP", opts);
  return { baselineId, candidateId, itt, pp, policiesDisagree: itt.overall !== pp.overall };
}

export interface ConfigSummary {
  configId: string;
  policy: Policy;
  runs: number;
  cases: number;
  successes: number;
  /** Tasa agrupada con Wilson (asume runs independientes: descriptivo) y bootstrap por clúster de caso (inferencial). */
  rate: number;
  wilson: Interval;
  clusterCi: Interval;
  passK: PassKSummary[];
  stability: StabilitySummary;
  tokens: { n: number; nulls: number; geoMean: number; cv: number };
  duration: { n: number; nulls: number; geoMean: number; cv: number };
  outcomes: Partial<Record<RunOutcome, number>>;
}

function costSummary(rs: readonly RunRow[], pick: (r: RunRow) => number | null) {
  const vals = rs.map(pick).filter((v): v is number => v !== null && Number.isFinite(v) && v > 0);
  return {
    n: vals.length,
    nulls: rs.length - vals.length,
    geoMean: vals.length ? Math.exp(mean(vals.map(Math.log))) : NaN,
    cv: coefVar(vals),
  };
}

export function summarizeConfig(rows: readonly RunRow[], configId: string, policy: Policy, opts: AnalysisOptions = {}): ConfigSummary {
  const rs = applyPolicy(rows, policy).filter((r) => r.configId === configId);
  const cases = byCase(rs);
  const counts: CaseCounts[] = [...cases].map(([caseId, x]) => ({ caseId, runs: x.length, successes: x.filter(isSuccess).length }));
  const successes = counts.reduce((a, c) => a + c.successes, 0);
  const clusters = [...cases.values()].map((x) => x.map((r) => (isSuccess(r) ? 1 : 0)));
  const boot = bootstrapClusterPooled(clusters, { seed: (opts.seed ?? 1) + seedFrom(`${policy}|${configId}`), ...(opts.B !== undefined ? { B: opts.B } : {}), ...(opts.alpha !== undefined ? { alpha: opts.alpha } : {}) });
  const w = wilson(successes, rs.length, opts.alpha ?? 0.05);
  const outcomes: Partial<Record<RunOutcome, number>> = {};
  for (const r of rs) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
  return {
    configId,
    policy,
    runs: rs.length,
    cases: cases.size,
    successes,
    rate: w.p,
    wilson: { lo: w.lo, hi: w.hi },
    clusterCi: { lo: boot.lo, hi: boot.hi },
    passK: (opts.ks ?? [1, 3, 5]).map((k) => passKSummary(counts, k)),
    stability: stability(counts),
    tokens: costSummary(rs, (r) => r.tokens),
    duration: costSummary(rs, (r) => r.durationMs),
    outcomes,
  };
}

