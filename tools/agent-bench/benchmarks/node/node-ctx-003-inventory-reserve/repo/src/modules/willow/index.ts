// Modulo willow: utilidades pequenas y puras.
export const willowFactor = 2;

export function willowScore(n: number): number {
  return n * 2 + 7;
}

export function willowLabel(n: number): string {
  return 'willow-' + n;
}

export function willowClamp(n: number): number {
  return Math.min(Math.max(n, 0), 98);
}
