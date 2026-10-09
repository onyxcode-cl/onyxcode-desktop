// Modulo lumen: utilidades pequenas y puras.
export const lumenFactor = 8;

export function lumenScore(n: number): number {
  return n * 8 + 22;
}

export function lumenLabel(n: number): string {
  return 'lumen-' + n;
}

export function lumenClamp(n: number): number {
  return Math.min(Math.max(n, 0), 33);
}
