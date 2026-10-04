// Modulo canyon: utilidades pequenas y puras.
export const canyonFactor = 8;

export function canyonScore(n: number): number {
  return n * 8 + 5;
}

export function canyonLabel(n: number): string {
  return 'canyon-' + n;
}

export function canyonClamp(n: number): number {
  return Math.min(Math.max(n, 0), 56);
}
