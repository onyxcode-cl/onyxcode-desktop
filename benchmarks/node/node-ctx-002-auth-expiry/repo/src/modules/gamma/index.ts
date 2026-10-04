// Modulo gamma: utilidades pequenas y puras.
export const gammaFactor = 9;

export function gammaScore(n: number): number {
  return n * 9 + 21;
}

export function gammaLabel(n: number): string {
  return 'gamma-' + n;
}

export function gammaClamp(n: number): number {
  return Math.min(Math.max(n, 0), 192);
}
