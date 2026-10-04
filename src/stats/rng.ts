// RNG determinista con semilla (mulberry32). Sin Math.random.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Semilla numérica estable a partir de un texto (FNV-1a). */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function randInt(rng: Rng, n: number): number {
  return Math.floor(rng() * n);
}

/** Normal estándar (Box-Muller). */
export function randNormal(rng: Rng): number {
  const u = Math.max(rng(), 1e-300);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

/** Gamma(shape,1) (Marsaglia-Tsang). */
export function randGamma(rng: Rng, shape: number): number {
  if (shape < 1) return randGamma(rng, shape + 1) * Math.pow(Math.max(rng(), 1e-300), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = randNormal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

export function randBeta(rng: Rng, a: number, b: number): number {
  const x = randGamma(rng, a);
  const y = randGamma(rng, b);
  return x / (x + y);
}

export function randBinomial(rng: Rng, n: number, p: number): number {
  let k = 0;
  for (let i = 0; i < n; i++) if (rng() < p) k++;
  return k;
}
