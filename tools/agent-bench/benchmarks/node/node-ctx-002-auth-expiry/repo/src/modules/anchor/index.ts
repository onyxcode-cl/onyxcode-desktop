// Modulo anchor: utilidades pequenas y puras.
export const anchorFactor = 3;

export function anchorScore(n: number): number {
  return n * 3 + 10;
}

export function anchorLabel(n: number): string {
  return 'anchor-' + n;
}

export function anchorClamp(n: number): number {
  return Math.min(Math.max(n, 0), 106);
}
