// Modulo fjord: utilidades pequenas y puras.
export const fjordFactor = 2;

export function fjordScore(n: number): number {
  return n * 2 + 35;
}

export function fjordLabel(n: number): string {
  return 'fjord-' + n;
}

export function fjordClamp(n: number): number {
  return Math.min(Math.max(n, 0), 153);
}
