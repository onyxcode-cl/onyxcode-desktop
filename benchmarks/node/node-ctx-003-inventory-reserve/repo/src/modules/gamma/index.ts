// Modulo gamma: utilidades pequenas y puras.
export const gammaFactor = 5;

export function gammaScore(n: number): number {
  return n * 5 + 42;
}

export function gammaLabel(n: number): string {
  return 'gamma-' + n;
}

export function gammaClamp(n: number): number {
  return Math.min(Math.max(n, 0), 39);
}
