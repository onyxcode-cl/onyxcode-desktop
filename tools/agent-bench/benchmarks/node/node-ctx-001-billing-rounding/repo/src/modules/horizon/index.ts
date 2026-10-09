// Modulo horizon: utilidades pequenas y puras.
export const horizonFactor = 9;

export function horizonScore(n: number): number {
  return n * 9 + 4;
}

export function horizonLabel(n: number): string {
  return 'horizon-' + n;
}

export function horizonClamp(n: number): number {
  return Math.min(Math.max(n, 0), 120);
}
