import type { Interval } from "./types.ts";
import { mean, quantileSorted, zTwoSided } from "./dist.ts";
import { mulberry32 } from "./rng.ts";

export const MAX_BOOTSTRAP = 50_000;

/** Intervalo de Wilson para k éxitos de n (descriptivo: asume runs independientes). */
export function wilson(k: number, n: number, alpha = 0.05): Interval & { p: number } {
  if (n <= 0) return { p: NaN, lo: NaN, hi: NaN };
  const z = zTwoSided(alpha);
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, center - half), hi: Math.min(1, center + half) };
}

export interface BootstrapOptions {
  seed?: number;
  /** Remuestreos (tope 50000). */
  B?: number;
  alpha?: number;
}

export interface BootstrapResult extends Interval {
  estimate: number;
  B: number;
  nClusters: number;
}

/**
 * Bootstrap percentil por clúster de caso. `values` es UN valor por caso
 * (media de sus repeticiones, o diferencia pareada de ese caso). Se remuestrean casos
 * con reemplazo, de modo que la incertidumbre refleja la variación entre casos.
 */
export function bootstrapClusterMean(values: readonly number[], opts: BootstrapOptions = {}): BootstrapResult {
  const n = values.length;
  const B = Math.min(Math.max(1, opts.B ?? 10_000), MAX_BOOTSTRAP);
  const alpha = opts.alpha ?? 0.05;
  const estimate = mean(values);
  if (n === 0) return { estimate, lo: NaN, hi: NaN, B, nClusters: 0 };
  const rng = mulberry32(opts.seed ?? 1);
  const stats = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += values[Math.floor(rng() * n)]!;
    stats[b] = s / n;
  }
  stats.sort();
  return { estimate, lo: quantileSorted(stats, alpha / 2), hi: quantileSorted(stats, 1 - alpha / 2), B, nClusters: n };
}

/**
 * Bootstrap por clúster de una tasa agrupada (razón de sumas): cada clúster es un caso
 * con varias repeticiones binarias o numéricas. Casos con más runs pesan más.
 */
export function bootstrapClusterPooled(clusters: readonly (readonly number[])[], opts: BootstrapOptions = {}): BootstrapResult {
  const n = clusters.length;
  const B = Math.min(Math.max(1, opts.B ?? 10_000), MAX_BOOTSTRAP);
  const alpha = opts.alpha ?? 0.05;
  const sums = clusters.map((c) => c.reduce((a, b) => a + b, 0));
  const cnts = clusters.map((c) => c.length);
  const totN = cnts.reduce((a, b) => a + b, 0);
  const estimate = totN === 0 ? NaN : sums.reduce((a, b) => a + b, 0) / totN;
  if (n === 0 || totN === 0) return { estimate, lo: NaN, hi: NaN, B, nClusters: n };
  const rng = mulberry32(opts.seed ?? 1);
  const stats = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    let s = 0;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const j = Math.floor(rng() * n);
      s += sums[j]!;
      c += cnts[j]!;
    }
    stats[b] = c === 0 ? 0 : s / c;
  }
  stats.sort();
  return { estimate, lo: quantileSorted(stats, alpha / 2), hi: quantileSorted(stats, 1 - alpha / 2), B, nClusters: n };
}
