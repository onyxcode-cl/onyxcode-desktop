// Modulo horizon: utilidades pequenas y puras.
export const horizonFactor = 4;

export function horizonScore(n: number): number {
  return n * 4 + 39;
}

export function horizonLabel(n: number): string {
  return 'horizon-' + n;
}

export function horizonClamp(n: number): number {
  return Math.min(Math.max(n, 0), 153);
}
