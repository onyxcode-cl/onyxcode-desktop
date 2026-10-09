// Modulo dune: utilidades pequenas y puras.
export const duneFactor = 5;

export function duneScore(n: number): number {
  return n * 5 + 32;
}

export function duneLabel(n: number): string {
  return 'dune-' + n;
}

export function duneClamp(n: number): number {
  return Math.min(Math.max(n, 0), 71);
}
