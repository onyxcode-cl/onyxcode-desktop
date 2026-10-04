// Potencia por Monte Carlo para diseño pareado por caso (éxito binario con repeticiones).
import { mulberry32, randBeta, randBinomial, type Rng } from "./rng.ts";
import { quantileSorted } from "./dist.ts";
import { MIN_CASES_DEFAULT } from "./decision.ts";
import { MPE_DEFAULT } from "./types.ts";

export const MAX_SIMS = 5000;
export const MAX_WALL_MS = 120_000;

export interface PowerSpec {
  /** Casos del benchmark. */
  nCases: number;
  /** Repeticiones por caso y configuración. */
  reps: number;
  /** Tasa de éxito base media. */
  baseRate: number;
  /** Mejora verdadera (proporción, 0.05 = 5 pp). */
  delta: number;
  /** Concentración Beta de la heterogeneidad entre casos (alto = casos homogéneos). Default 2: muy heterogéneo. */
  concentration?: number;
  alpha?: number;
  /**
   * Regla de decisión simulada. "mpe" (por defecto) = la REAL del veredicto MEJORA: límite inferior del IC bootstrap por
   * clúster de caso > MPE de éxito (margen). "zero" = solo IC inferior > 0 (detectar cualquier mejora; menos estricta).
   */
  rule?: "mpe" | "zero";
  /** MPE de éxito (proporción) usado por la regla "mpe". Por defecto 0.05. */
  margin?: number;
  /** Mínimo de casos para decidir (como en el análisis real; por defecto 10). */
  minCases?: number;
}

export interface PowerOptions {
  seed?: number;
  /** Simulaciones (tope 5000). */
  sims?: number;
  /** Tope de tiempo (ms, tope 120000). */
  maxMs?: number;
  /** Remuestreos bootstrap por simulación (antes sign-flip). */
  flips?: number;
  /** Reloj inyectable para tests. */
  now?: () => number;
}

export interface PowerResult {
  power: number;
  simsRun: number;
  simsRequested: number;
  /** true si se cortó por tiempo antes de completar. */
  truncated: boolean;
  elapsedMs: number;
  rule: "mpe" | "zero";
  margin: number;
  /** Mejora media realmente simulada (pB - pA tras el tope en 1). Si es menor que `delta`, hubo recorte en el extremo. */
  effectiveDelta: number;
  /** true si effectiveDelta < 95 % de delta: la potencia corresponde a un efecto menor que el pedido. */
  deltaClipped: boolean;
}

interface Sim { hit: boolean; sumDelta: number }

function simulateOnce(spec: PowerSpec, rng: Rng, boots: number): Sim {
  const kappa = spec.concentration ?? 2;
  const a0 = Math.max(spec.baseRate * kappa, 1e-3);
  const b0 = Math.max((1 - spec.baseRate) * kappa, 1e-3);
  const d: number[] = [];
  let sumDelta = 0;
  for (let i = 0; i < spec.nCases; i++) {
    const pA = randBeta(rng, a0, b0);
    // Se recorta a [0,1] (inevitable en probabilidades), pero se mide el efecto realmente simulado y se avisa en el resultado.
    const pB = Math.min(1, Math.max(0, pA + spec.delta));
    sumDelta += pB - pA;
    d.push(randBinomial(rng, spec.reps, pB) / spec.reps - randBinomial(rng, spec.reps, pA) / spec.reps);
  }
  const n = d.length;
  const minCases = spec.minCases ?? MIN_CASES_DEFAULT;
  // Mismas reglas que el análisis real: pocos casos o diferencias todas iguales (IC degenerado) no dan MEJORA.
  if (n < minCases || d.every((x) => x === d[0])) return { hit: false, sumDelta };
  const margin = (spec.rule ?? "mpe") === "mpe" ? (spec.margin ?? MPE_DEFAULT.success) : 0;
  const stats = new Float64Array(boots);
  for (let b = 0; b < boots; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += d[Math.floor(rng() * n)]!;
    stats[b] = s / n;
  }
  stats.sort();
  const lo = quantileSorted(stats, (spec.alpha ?? 0.05) / 2);
  return { hit: lo > margin, sumDelta };
}

export function estimatePower(spec: PowerSpec, opts: PowerOptions = {}): PowerResult {
  const now = opts.now ?? (() => Date.now());
  const simsRequested = Math.min(Math.max(1, Math.floor(opts.sims ?? 1000)), MAX_SIMS);
  const maxMs = Math.min(opts.maxMs ?? MAX_WALL_MS, MAX_WALL_MS);
  const boots = Math.min(Math.max(49, opts.flips ?? 199), 999);
  const rng = mulberry32(opts.seed ?? 1);
  const t0 = now();
  let hits = 0;
  let run = 0;
  let sumDelta = 0;
  for (; run < simsRequested; run++) {
    if (run % 16 === 0 && run > 0 && now() - t0 > maxMs) break;
    const s = simulateOnce(spec, rng, boots);
    if (s.hit) hits++;
    sumDelta += s.sumDelta;
  }
  const effectiveDelta = run && spec.nCases > 0 ? sumDelta / (run * spec.nCases) : NaN;
  return {
    power: run ? hits / run : NaN, simsRun: run, simsRequested, truncated: run < simsRequested, elapsedMs: now() - t0,
    rule: spec.rule ?? "mpe", margin: spec.margin ?? MPE_DEFAULT.success,
    effectiveDelta, deltaClipped: Number.isFinite(effectiveDelta) && effectiveDelta < 0.95 * spec.delta,
  };
}

export interface MdeResult {
  /** Menor delta de la rejilla con potencia >= objetivo, o null si ninguno la alcanza. */
  mde: number | null;
  curve: { delta: number; power: number }[];
  simsTotal: number;
  truncated: boolean;
}

/**
 * Efecto mínimo detectable por rejilla creciente de deltas, compartiendo el presupuesto
 * total (<=5000 sims y <=120 s en conjunto).
 */
export function minimumDetectableEffect(
  base: Omit<PowerSpec, "delta">,
  opts: PowerOptions & { targetPower?: number; grid?: number[] } = {},
): MdeResult {
  const grid = opts.grid ?? [0.05, 0.1, 0.15, 0.2, 0.25, 0.3];
  const target = opts.targetPower ?? 0.8;
  const now = opts.now ?? (() => Date.now());
  const totalSims = Math.min(opts.sims ?? 2000, MAX_SIMS);
  const per = Math.max(1, Math.floor(totalSims / grid.length));
  const maxMs = Math.min(opts.maxMs ?? MAX_WALL_MS, MAX_WALL_MS);
  const t0 = now();
  const curve: { delta: number; power: number }[] = [];
  let simsTotal = 0;
  let truncated = false;
  let mde: number | null = null;
  for (const delta of grid) {
    const left = maxMs - (now() - t0);
    if (left <= 0) {
      truncated = true;
      break;
    }
    const r = estimatePower({ ...base, delta }, { ...opts, sims: per, maxMs: left, seed: (opts.seed ?? 1) + Math.round(delta * 1000) });
    simsTotal += r.simsRun;
    if (r.truncated) truncated = true;
    curve.push({ delta, power: r.power });
    if (mde === null && r.power >= target) {
      mde = delta;
      break;
    }
  }
  return { mde, curve, simsTotal, truncated };
}
