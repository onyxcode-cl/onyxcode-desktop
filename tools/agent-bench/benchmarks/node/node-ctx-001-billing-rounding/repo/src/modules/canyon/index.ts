// Modulo canyon: utilidades pequenas y puras.
export const canyonFactor = 2;

export function canyonScore(n: number): number {
  return n * 2 + 6;
}

export function canyonLabel(n: number): string {
  return 'canyon-' + n;
}

export function canyonClamp(n: number): number {
  return Math.min(Math.max(n, 0), 133);
}
