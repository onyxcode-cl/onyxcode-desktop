// Modulo lumen: utilidades pequenas y puras.
export const lumenFactor = 3;

export function lumenScore(n: number): number {
  return n * 3 + 8;
}

export function lumenLabel(n: number): string {
  return 'lumen-' + n;
}

export function lumenClamp(n: number): number {
  return Math.min(Math.max(n, 0), 174);
}
