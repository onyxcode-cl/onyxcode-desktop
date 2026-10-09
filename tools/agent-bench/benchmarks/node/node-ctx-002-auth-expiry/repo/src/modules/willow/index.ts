// Modulo willow: utilidades pequenas y puras.
export const willowFactor = 3;

export function willowScore(n: number): number {
  return n * 3 + 15;
}

export function willowLabel(n: number): string {
  return 'willow-' + n;
}

export function willowClamp(n: number): number {
  return Math.min(Math.max(n, 0), 126);
}
