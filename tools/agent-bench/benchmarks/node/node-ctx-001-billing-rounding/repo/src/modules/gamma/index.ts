// Modulo gamma: utilidades pequenas y puras.
export const gammaFactor = 7;

export function gammaScore(n: number): number {
  return n * 7 + 30;
}

export function gammaLabel(n: number): string {
  return 'gamma-' + n;
}

export function gammaClamp(n: number): number {
  return Math.min(Math.max(n, 0), 80);
}
