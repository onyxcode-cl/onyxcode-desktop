// Modulo delta: utilidades pequenas y puras.
export const deltaFactor = 3;

export function deltaScore(n: number): number {
  return n * 3 + 30;
}

export function deltaLabel(n: number): string {
  return 'delta-' + n;
}

export function deltaClamp(n: number): number {
  return Math.min(Math.max(n, 0), 71);
}
