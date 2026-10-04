// Pruebas de hipótesis pareadas / exactas.
import { binomCdfHalf, normSf } from "./dist.ts";
import { mulberry32 } from "./rng.ts";

export interface McNemarResult {
  b: number;
  c: number;
  n: number;
  p: number;
}

/** McNemar exacto bilateral: b = A éxito/B fallo, c = A fallo/B éxito. */
export function mcnemarExact(b: number, c: number): McNemarResult {
  const n = b + c;
  if (n === 0) return { b, c, n, p: 1 };
  const p = Math.min(1, 2 * binomCdfHalf(Math.min(b, c), n));
  return { b, c, n, p };
}

export interface SignFlipResult {
  p: number;
  /** Pares con diferencia distinta de 0. */
  nNonZero: number;
  meanDiff: number;
  method: "exact" | "montecarlo" | "trivial";
  resamples: number;
}

export interface SignFlipOptions {
  seed?: number;
  /** Remuestreos Monte Carlo cuando no se enumera. */
  nResamples?: number;
  /** Enumeración exacta si nNonZero <= exactMax (máx. 20). */
  exactMax?: number;
}

/** Permutación sign-flip pareada, bilateral, estadístico = |suma de diferencias|. */
export function signFlipTest(diffs: readonly number[], opts: SignFlipOptions = {}): SignFlipResult {
  const meanDiff = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : NaN;
  const d = diffs.filter((x) => x !== 0 && Number.isFinite(x));
  const m = d.length;
  if (m === 0) return { p: 1, nNonZero: 0, meanDiff, method: "trivial", resamples: 0 };
  const obs = Math.abs(d.reduce((a, b) => a + b, 0));
  const tol = 1e-9 * Math.max(1, d.reduce((a, b) => a + Math.abs(b), 0));
  const exactMax = Math.min(opts.exactMax ?? 16, 20);
  if (m <= exactMax) {
    const total = 2 ** m;
    let count = 0;
    for (let mask = 0; mask < total; mask++) {
      let s = 0;
      for (let i = 0; i < m; i++) s += (mask >> i) & 1 ? d[i]! : -d[i]!;
      if (Math.abs(s) >= obs - tol) count++;
    }
    return { p: count / total, nNonZero: m, meanDiff, method: "exact", resamples: total };
  }
  const N = Math.min(Math.max(100, opts.nResamples ?? 10_000), 200_000);
  const rng = mulberry32(opts.seed ?? 1);
  let count = 0;
  for (let r = 0; r < N; r++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += rng() < 0.5 ? d[i]! : -d[i]!;
    if (Math.abs(s) >= obs - tol) count++;
  }
  return { p: (count + 1) / (N + 1), nNonZero: m, meanDiff, method: "montecarlo", resamples: N };
}

export interface WilcoxonResult {
  p: number;
  /** W+ (suma de rangos de diferencias positivas). */
  wPlus: number;
  nNonZero: number;
  method: "exact" | "normal" | "trivial";
}

/** Wilcoxon de rangos con signo, bilateral. Exacto (con empates, vía rangos doblados) si n<=50, si no normal con corrección. */
export function wilcoxonSignedRank(diffs: readonly number[]): WilcoxonResult {
  const d = diffs.filter((x) => x !== 0 && Number.isFinite(x));
  const n = d.length;
  if (n === 0) return { p: 1, wPlus: 0, nNonZero: 0, method: "trivial" };
  const idx = d.map((_, i) => i).sort((i, j) => Math.abs(d[i]!) - Math.abs(d[j]!));
  const r2 = new Array<number>(n).fill(0); // rangos doblados (enteros)
  const tieSizes: number[] = [];
  for (let s = 0; s < n; ) {
    let e = s;
    while (e + 1 < n && Math.abs(d[idx[e + 1]!]!) === Math.abs(d[idx[s]!]!)) e++;
    const mid2 = s + 1 + (e + 1); // 2 * rango medio
    for (let k = s; k <= e; k++) r2[idx[k]!] = mid2;
    tieSizes.push(e - s + 1);
    s = e + 1;
  }
  let w2 = 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += r2[i]!;
    if (d[i]! > 0) w2 += r2[i]!;
  }
  const wPlus = w2 / 2;
  if (n <= 50) {
    const counts = new Float64Array(total + 1);
    counts[0] = 1;
    let top = 0;
    for (let i = 0; i < n; i++) {
      const r = r2[i]!;
      for (let s = top; s >= 0; s--) if (counts[s]) counts[s + r] = counts[s + r]! + counts[s]!;
      top += r;
    }
    const dev = Math.abs(w2 - total / 2);
    let tail = 0;
    for (let s = 0; s <= total; s++) if (Math.abs(s - total / 2) >= dev - 1e-9) tail += counts[s]!;
    return { p: Math.min(1, tail / 2 ** n), wPlus, nNonZero: n, method: "exact" };
  }
  const mu = (n * (n + 1)) / 4;
  let varW = (n * (n + 1) * (2 * n + 1)) / 24;
  for (const t of tieSizes) varW -= (t * t * t - t) / 48;
  const z = (Math.abs(wPlus - mu) - 0.5) / Math.sqrt(varW);
  return { p: Math.min(1, 2 * normSf(Math.max(0, z))), wPlus, nNonZero: n, method: "normal" };
}
