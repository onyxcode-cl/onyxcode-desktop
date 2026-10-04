// Potencia por Monte Carlo para diseño pareado por caso (éxito binario con repeticiones).
import { mulberry32, randBeta, randBinomial, type Rng } from "./rng.ts";

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
}

export interface PowerOptions {
  seed?: number;
  /** Simulaciones (tope 5000). */
  sims?: number;
  /** Tope de tiempo (ms, tope 120000). */
  maxMs?: number;
  /** Remuestreos sign-flip por simulación. */
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
}

function simulateOnce(spec: PowerSpec, rng: Rng, flips: number): boolean {
  const kappa = spec.concentration ?? 2;
  const a0 = Math.max(spec.baseRate * kappa, 1e-3);
  const b0 = Math.max((1 - spec.baseRate) * kappa, 1e-3);
  const d: number[] = [];
  for (let i = 0; i < spec.nCases; i++) {
    const pA = randBeta(rng, a0, b0);
    const pB = Math.min(1, Math.max(0, pA + spec.delta));
    d.push(randBinomial(rng, spec.reps, pB) / spec.reps - randBinomial(rng, spec.reps, pA) / spec.reps);
  }
  const nz = d.filter((x) => x !== 0);
  if (nz.length === 0) return false;
  const obs = Math.abs(nz.reduce((a, b) => a + b, 0));
  let ge = 0;
  for (let f = 0; f < flips; f++) {
    let s = 0;
    for (let i = 0; i < nz.length; i++) s += rng() < 0.5 ? nz[i]! : -nz[i]!;
    if (Math.abs(s) >= obs - 1e-12) ge++;
  }
  return (ge + 1) / (flips + 1) <= (spec.alpha ?? 0.05);
}

export function estimatePower(spec: PowerSpec, opts: PowerOptions = {}): PowerResult {
  const now = opts.now ?? (() => Date.now());
  const simsRequested = Math.min(Math.max(1, Math.floor(opts.sims ?? 1000)), MAX_SIMS);
  const maxMs = Math.min(opts.maxMs ?? MAX_WALL_MS, MAX_WALL_MS);
  const flips = Math.min(Math.max(49, opts.flips ?? 199), 999);
  const rng = mulberry32(opts.seed ?? 1);
  const t0 = now();
  let hits = 0;
  let run = 0;
  for (; run < simsRequested; run++) {
    if (run % 16 === 0 && run > 0 && now() - t0 > maxMs) break;
    if (simulateOnce(spec, rng, flips)) hits++;
  }
  return { power: run ? hits / run : NaN, simsRun: run, simsRequested, truncated: run < simsRequested, elapsedMs: now() - t0 };
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
