// Modulo glacier: utilidades pequenas y puras.
export const glacierFactor = 3;

export function glacierScore(n: number): number {
  return n * 3 + 14;
}

export function glacierLabel(n: number): string {
  return 'glacier-' + n;
}

export function glacierClamp(n: number): number {
  return Math.min(Math.max(n, 0), 104);
}
