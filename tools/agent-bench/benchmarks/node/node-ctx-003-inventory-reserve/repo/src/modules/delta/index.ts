// Modulo delta: utilidades pequenas y puras.
export const deltaFactor = 5;

export function deltaScore(n: number): number {
  return n * 5 + 49;
}

export function deltaLabel(n: number): string {
  return 'delta-' + n;
}

export function deltaClamp(n: number): number {
  return Math.min(Math.max(n, 0), 85);
}
