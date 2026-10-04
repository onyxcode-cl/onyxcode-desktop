// pass^k, pass@k y estabilidad por caso.
import { mean, sd } from "./dist.ts";

/** Estimador insesgado de p^k: C(c,k)/C(n,k). */
export function passHatK(c: number, n: number, k: number): number {
  if (k < 1 || n < k) return NaN;
  if (c < k) return 0;
  let v = 1;
  for (let i = 0; i < k; i++) v *= (c - i) / (n - i);
  return v;
}

/** Estimador insesgado de pass@k: 1 - C(n-c,k)/C(n,k). */
export function passAtK(c: number, n: number, k: number): number {
  if (k < 1 || n < k) return NaN;
  if (n - c < k) return 1;
  let v = 1;
  for (let i = 0; i < k; i++) v *= (n - c - i) / (n - i);
  return 1 - v;
}

export interface CaseCounts {
  caseId: string;
  successes: number;
  runs: number;
}

export interface PassKSummary {
  k: number;
  /** Media sobre casos con runs >= k. */
  passPowK: number;
  passAtK: number;
  casesUsed: number;
  casesSkipped: number;
}

export function passKSummary(cases: readonly CaseCounts[], k: number): PassKSummary {
  const usable = cases.filter((c) => c.runs >= k);
  return {
    k,
    passPowK: usable.length ? mean(usable.map((c) => passHatK(c.successes, c.runs, k))) : NaN,
    passAtK: usable.length ? mean(usable.map((c) => passAtK(c.successes, c.runs, k))) : NaN,
    casesUsed: usable.length,
    casesSkipped: cases.length - usable.length,
  };
}

export interface StabilitySummary {
  /** Media de |2p-1| por caso: 1 = totalmente consistente (siempre pasa o siempre falla), 0 = moneda al aire. */
  consistency: number;
  /** Fracción de casos con todos los runs iguales. */
  fullyConsistentFraction: number;
  /** Casos con resultado mixto (flaky). */
  flakyCases: number;
  /** Desviación estándar entre casos de la tasa de éxito. */
  sdPassRateAcrossCases: number;
  cases: number;
}

export function stability(cases: readonly CaseCounts[]): StabilitySummary {
  const usable = cases.filter((c) => c.runs > 0);
  if (!usable.length) return { consistency: NaN, fullyConsistentFraction: NaN, flakyCases: 0, sdPassRateAcrossCases: NaN, cases: 0 };
  const ps = usable.map((c) => c.successes / c.runs);
  const full = usable.filter((c) => c.successes === 0 || c.successes === c.runs).length;
  return {
    consistency: mean(ps.map((p) => Math.abs(2 * p - 1))),
    fullyConsistentFraction: full / usable.length,
    flakyCases: usable.length - full,
    sdPassRateAcrossCases: sd(ps),
    cases: usable.length,
  };
}

/** Coeficiente de variación en escala original (null-safe: ignora no finitos). */
export function coefVar(xs: readonly number[]): number {
  const v = xs.filter((x) => Number.isFinite(x));
  const m = mean(v);
  return v.length < 2 || m === 0 ? NaN : sd(v) / Math.abs(m);
}
