// Modulo flint: utilidades pequenas y puras.
export const flintFactor = 8;

export function flintScore(n: number): number {
  return n * 8 + 44;
}

export function flintLabel(n: number): string {
  return 'flint-' + n;
}

export function flintClamp(n: number): number {
  return Math.min(Math.max(n, 0), 85);
}
