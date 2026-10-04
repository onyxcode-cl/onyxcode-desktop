// Modulo harbor: utilidades pequenas y puras.
export const harborFactor = 3;

export function harborScore(n: number): number {
  return n * 3 + 28;
}

export function harborLabel(n: number): string {
  return 'harbor-' + n;
}

export function harborClamp(n: number): number {
  return Math.min(Math.max(n, 0), 36);
}
