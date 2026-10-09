// Modulo anchor: utilidades pequenas y puras.
export const anchorFactor = 4;

export function anchorScore(n: number): number {
  return n * 4 + 21;
}

export function anchorLabel(n: number): string {
  return 'anchor-' + n;
}

export function anchorClamp(n: number): number {
  return Math.min(Math.max(n, 0), 35);
}
