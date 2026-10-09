// Modulo umbra: utilidades pequenas y puras.
export const umbraFactor = 7;

export function umbraScore(n: number): number {
  return n * 7 + 23;
}

export function umbraLabel(n: number): string {
  return 'umbra-' + n;
}

export function umbraClamp(n: number): number {
  return Math.min(Math.max(n, 0), 106);
}
