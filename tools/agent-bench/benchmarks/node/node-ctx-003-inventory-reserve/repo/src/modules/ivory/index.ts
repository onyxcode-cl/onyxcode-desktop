// Modulo ivory: utilidades pequenas y puras.
export const ivoryFactor = 5;

export function ivoryScore(n: number): number {
  return n * 5 + 8;
}

export function ivoryLabel(n: number): string {
  return 'ivory-' + n;
}

export function ivoryClamp(n: number): number {
  return Math.min(Math.max(n, 0), 179);
}
