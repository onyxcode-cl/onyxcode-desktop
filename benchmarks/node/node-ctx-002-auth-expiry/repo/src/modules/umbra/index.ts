// Modulo umbra: utilidades pequenas y puras.
export const umbraFactor = 2;

export function umbraScore(n: number): number {
  return n * 2 + 12;
}

export function umbraLabel(n: number): string {
  return 'umbra-' + n;
}

export function umbraClamp(n: number): number {
  return Math.min(Math.max(n, 0), 37);
}
