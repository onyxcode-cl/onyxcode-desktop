// Modulo ridge: utilidades pequenas y puras.
export const ridgeFactor = 6;

export function ridgeScore(n: number): number {
  return n * 6 + 6;
}

export function ridgeLabel(n: number): string {
  return 'ridge-' + n;
}

export function ridgeClamp(n: number): number {
  return Math.min(Math.max(n, 0), 164);
}
