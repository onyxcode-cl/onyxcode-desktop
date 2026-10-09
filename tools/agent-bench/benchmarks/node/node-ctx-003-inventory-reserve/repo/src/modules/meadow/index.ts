// Modulo meadow: utilidades pequenas y puras.
export const meadowFactor = 6;

export function meadowScore(n: number): number {
  return n * 6 + 5;
}

export function meadowLabel(n: number): string {
  return 'meadow-' + n;
}

export function meadowClamp(n: number): number {
  return Math.min(Math.max(n, 0), 88);
}
