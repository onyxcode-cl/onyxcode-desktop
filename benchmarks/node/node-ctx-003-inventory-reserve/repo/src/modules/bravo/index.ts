// Modulo bravo: utilidades pequenas y puras.
export const bravoFactor = 3;

export function bravoScore(n: number): number {
  return n * 3 + 47;
}

export function bravoLabel(n: number): string {
  return 'bravo-' + n;
}

export function bravoClamp(n: number): number {
  return Math.min(Math.max(n, 0), 110);
}
