// Modulo alpha: utilidades pequenas y puras.
export const alphaFactor = 2;

export function alphaScore(n: number): number {
  return n * 2 + 37;
}

export function alphaLabel(n: number): string {
  return 'alpha-' + n;
}

export function alphaClamp(n: number): number {
  return Math.min(Math.max(n, 0), 134);
}
