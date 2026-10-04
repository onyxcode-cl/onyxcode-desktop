// Análisis de experimento: ITT vs PP, escala log para tokens/duración, decisión con MPE.
import type { Interval, MetricName, Mpe, Policy, RunOutcome, RunRow, Veredicto } from "./types.ts";
import { MPE_DEFAULT } from "./types.ts";
import { mean, sd, zTwoSided } from "./dist.ts";
import { bootstrapClusterMean, bootstrapClusterPooled, wilson } from "./intervals.ts";
import { holm } from "./multiple.ts";
import { mcnemarExact, signFlipTest, wilcoxonSignedRank } from "./tests.ts";
import { coefVar, passKSummary, stability, type CaseCounts, type PassKSummary, type StabilitySummary } from "./reliability.ts";
import { MIN_CASES_DEFAULT, decideMetric, decideOverall, marginFor, marginLossFor, type MetricDecision } from "./decision.ts";
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
  /** Mínimo de casos pareados para emitir un veredicto (por defecto 10; si no, SIN EVIDENCIA y powered=false). */
  minCases?: number;
}

function attemptOrder(r: RunRow): string {
  return `${r.finishedAt ?? ""}|${r.startedAt ?? ""}|${r.runId ?? ""}`;
}

/**
 * Deduplica por (caso, config, repetición) quedándose con el último intento (finishedAt, startedAt, runId).
 * La reanudación del motor puede guardar un 2º run de la misma celda tras un infra_error: sin esto el caso pesaría doble
 * y el intento fallido viejo contaría como fallo en ITT. Filas sin `rep` no se deduplican. Devuelve cuántas se descartaron.
 */
export function dedupeRows(rows: readonly RunRow[]): { rows: RunRow[]; discarded: number } {
  const last = new Map<string, RunRow>();
  const keep: (RunRow | string)[] = [];
  for (const r of rows) {
    if (r.rep === undefined) { keep.push(r); continue; }
    const k = JSON.stringify([r.caseId, r.configId, r.rep]);
    const prev = last.get(k);
    if (prev === undefined) { last.set(k, r); keep.push(k); }
    else if (attemptOrder(r) >= attemptOrder(prev)) last.set(k, r);
  }
  const out: RunRow[] = [];
  const emitted = new Set<string>();
  for (const x of keep) {
    if (typeof x === "string") { if (!emitted.has(x)) { emitted.add(x); out.push(last.get(x)!); } } else out.push(x);
  }
  return { rows: out, discarded: rows.length - out.length };
}

/** Filas efectivas por política. ITT: todas (deduplicadas). PP: sin infra_error/rate_limited/cancelled ni éxito sin evaluar. */
export function applyPolicy(rows: readonly RunRow[], policy: Policy): RunRow[] {
  const dd = dedupeRows(rows).rows;
  if (policy === "ITT") return dd;
  return dd.filter((r) => !NON_AGENT_OUTCOMES.includes(r.outcome) && !(r.outcome === "completed" && r.success === null));
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

/**
 * Valores por run de cada caso en la escala de análisis; ln para tokens/duración. null/<=0 se ignoran.
 * M1: tokens/duración EXCLUYEN siempre infra_error, cancelled y rate_limited (también en ITT): su duración es la de
 * arranque/espera, no del agente, y sesgaría la media geométrica. ITT solo cambia el tratamiento del éxito.
 */
export function perCaseSamples(rows: readonly RunRow[], metric: MetricName): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [caseId, rs] of byCase(rows)) {
    const vals: number[] = [];
    for (const r of rs) {
      if (metric === "success") vals.push(isSuccess(r) ? 1 : 0);
      else {
        if (NON_AGENT_OUTCOMES.includes(r.outcome)) continue;
        const v = metric === "tokens" ? r.tokens : r.durationMs;
        if (v !== null && Number.isFinite(v) && v > 0) vals.push(Math.log(v));
      }
    }
    if (vals.length) out.set(caseId, vals);
  }
  return out;
}

/** Valor por caso (media de sus runs) en la escala de análisis. Ver perCaseSamples para las exclusiones. */
export function perCaseValues(rows: readonly RunRow[], metric: MetricName): Map<string, number> {
  const out = new Map<string, number>();
  for (const [k, v] of perCaseSamples(rows, metric)) out.set(k, mean(v));
  return out;
}

/**
 * Suelo de error estándar de la diferencia de medias por caso, solo cuando TODAS las diferencias son iguales (IC bootstrap
 * degenerado). Éxito: varianza de Bernoulli suavizada (Laplace) dentro de cada caso; logs: varianza muestral intra-caso.
 */
function withinCaseSeFloor(ids: readonly string[], a: Map<string, number[]>, b: Map<string, number[]>, metric: MetricName): number {
  const v = (xs: readonly number[]): number => {
    if (metric === "success") {
      const p = (xs.reduce((s, x) => s + x, 0) + 1) / (xs.length + 2);
      return p * (1 - p);
    }
    const s = sd(xs);
    return Number.isFinite(s) ? s * s : 0;
  };
  let tot = 0;
  for (const k of ids) {
    const xa = a.get(k)!;
    const xb = b.get(k)!;
    tot += v(xa) / xa.length + v(xb) / xb.length;
  }
  return Math.sqrt(tot) / ids.length;
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
  /** b, c discordantes; ties = casos con tasa exactamente 0.5 en alguna config (excluidos: no son ni éxito ni fallo). */
  mcnemar?: { b: number; c: number; ties: number; p: number };
  /** true si se aplicó el suelo de varianza intra-caso porque todas las diferencias eran iguales (A8). */
  withinFloorApplied: boolean;
  /** true si el veredicto fue degradado a SIN EVIDENCIA porque el p ajustado por Holm no supera alpha (M2). */
  holmDowngraded: boolean;
  decision: MetricDecision;
}

export interface PolicyComparison {
  policy: Policy;
  metrics: Partial<Record<MetricName, MetricComparison>>;
  overall: Veredicto;
  runsBaseline: number;
  runsCandidate: number;
  /** Runs descartados por repetición duplicada (A9), solo de las dos configuraciones comparadas. */
  duplicatesDiscarded: number;
}

const METRICS: MetricName[] = ["success", "tokens", "duration"];

function compareMetric(sa: Map<string, number[]>, sb: Map<string, number[]>, metric: MetricName, opts: AnalysisOptions, tag: string): Omit<MetricComparison, "pSignFlipHolm" | "holmDowngraded"> | null {
  const a = new Map([...sa].map(([k, v]) => [k, mean(v)] as const));
  const b = new Map([...sb].map(([k, v]) => [k, mean(v)] as const));
  const ids = [...a.keys()].filter((k) => b.has(k)).sort();
  if (ids.length === 0) return null;
  const unpaired = new Set([...a.keys(), ...b.keys()]).size - ids.length;
  const va = ids.map((k) => a.get(k)!);
  const vb = ids.map((k) => b.get(k)!);
  const d = vb.map((x, i) => x - va[i]!);
  const seed = (opts.seed ?? 1) + seedFrom(tag + metric);
  const bo = { seed, ...(opts.B !== undefined ? { B: opts.B } : {}), ...(opts.alpha !== undefined ? { alpha: opts.alpha } : {}) };
  const boot0 = bootstrapClusterMean(d, bo);
  // A8: si todas las diferencias son iguales el bootstrap da un IC de ancho 0 (falso "EQUIVALENTE"): se usa el suelo intra-caso.
  const degenerate = d.length > 0 && d.every((x) => x === d[0]);
  let boot = boot0;
  let withinFloorApplied = false;
  if (degenerate) {
    const se = withinCaseSeFloor(ids, sa, sb, metric);
    if (se > 0) {
      const h = zTwoSided(opts.alpha ?? 0.05) * se;
      boot = { ...boot0, lo: boot0.estimate - h, hi: boot0.estimate + h };
      withinFloorApplied = true;
    }
  }
  const sf = signFlipTest(d, { seed, ...(opts.nResamples !== undefined ? { nResamples: opts.nResamples } : {}) });
  const wx = wilcoxonSignedRank(d);
  const log = metric !== "success";
  const mpe = opts.mpe ?? MPE_DEFAULT;
  const decision = decideMetric({
    estimate: boot.estimate, lo: boot.lo, hi: boot.hi, margin: marginFor(metric, mpe), marginLoss: marginLossFor(metric, mpe),
    direction: metric === "success" ? 1 : -1, nCases: ids.length, minCases: opts.minCases ?? MIN_CASES_DEFAULT,
    ...(opts.alpha !== undefined ? { alpha: opts.alpha } : {}),
  });
  const res: Omit<MetricComparison, "pSignFlipHolm" | "holmDowngraded"> = {
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
    withinFloorApplied,
    decision,
  };
  if (log) {
    res.ratio = Math.exp(boot.estimate);
    res.pctChange = Math.exp(boot.estimate) - 1;
    res.pctChangeCi = { lo: Math.exp(boot.lo) - 1, hi: Math.exp(boot.hi) - 1 };
  } else {
    // McNemar a nivel de caso: un caso "pasa" si su tasa > 0.5.
    // Empate exacto (tasa 0.5) no es éxito ni fallo: ese caso se excluye y se cuenta en `ties`.
    let bb = 0;
    let cc = 0;
    let ties = 0;
    for (let i = 0; i < ids.length; i++) {
      if (va[i] === 0.5 || vb[i] === 0.5) { ties++; continue; }
      const pa = va[i]! > 0.5;
      const pb = vb[i]! > 0.5;
      if (pa && !pb) bb++;
      else if (!pa && pb) cc++;
    }
    const mc = mcnemarExact(bb, cc);
    res.mcnemar = { b: bb, c: cc, ties, p: mc.p };
  }
  return res;
}

export function comparePolicy(rows: readonly RunRow[], baselineId: string, candidateId: string, policy: Policy, opts: AnalysisOptions = {}): PolicyComparison {
  const dd = dedupeRows(rows);
  const eff = applyPolicy(dd.rows, policy);
  const A = eff.filter((r) => r.configId === baselineId);
  const B = eff.filter((r) => r.configId === candidateId);
  const duplicatesDiscarded = dd.rows.length === rows.length ? 0 : rows.filter((r) => r.configId === baselineId || r.configId === candidateId).length - dd.rows.filter((r) => r.configId === baselineId || r.configId === candidateId).length;
  const tag = `${policy}|${baselineId}|${candidateId}|`;
  const raw: Omit<MetricComparison, "pSignFlipHolm" | "holmDowngraded">[] = [];
  for (const m of METRICS) {
    const c = compareMetric(perCaseSamples(A, m), perCaseSamples(B, m), m, opts, tag);
    if (c) raw.push(c);
  }
  const adj = holm(raw.map((r) => r.pSignFlip));
  const metrics: Partial<Record<MetricName, MetricComparison>> = {};
  // M2: Holm sobre las métricas principales. Una MEJORA / MEJORA MENOR cuyo p ajustado no baja de alpha se degrada a
  // SIN EVIDENCIA. Las regresiones nunca se suavizan (prudencia: un falso aviso cuesta menos que una regresión oculta).
  const alpha = opts.alpha ?? 0.05;
  raw.forEach((r, i) => {
    const pAdj = adj[i]!;
    let decision = r.decision;
    let holmDowngraded = false;
    if ((decision.veredicto === "MEJORA" || decision.veredicto === "MEJORA MENOR") && !(pAdj <= alpha)) {
      holmDowngraded = true;
      decision = { ...decision, veredicto: "SIN EVIDENCIA", razon: `${decision.razon}; pero el p ajustado por Holm (${pAdj.toFixed(4)}) no supera alpha=${alpha}` };
    }
    metrics[r.metric] = { ...r, decision, pSignFlipHolm: pAdj, holmDowngraded };
  });
  const s = metrics.success?.decision.veredicto ?? "SIN EVIDENCIA";
  const overall = decideOverall({
    success: s,
    ...(metrics.tokens ? { tokens: metrics.tokens.decision.veredicto } : {}),
    ...(metrics.duration ? { duration: metrics.duration.decision.veredicto } : {}),
  });
  return { policy, metrics, overall, runsBaseline: A.length, runsCandidate: B.length, duplicatesDiscarded };
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
    // M1: coste solo sobre runs que ejecutaron al agente (también en ITT).
    tokens: costSummary(rs.filter((r) => !NON_AGENT_OUTCOMES.includes(r.outcome)), (r) => r.tokens),
    duration: costSummary(rs.filter((r) => !NON_AGENT_OUTCOMES.includes(r.outcome)), (r) => r.durationMs),
    outcomes,
  };
}

