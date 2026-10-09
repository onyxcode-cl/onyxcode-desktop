// Modulo anchor: utilidades pequenas y puras.
export const anchorFactor = 9;

export function anchorScore(n: number): number {
  return n * 9 + 22;
}

export function anchorLabel(n: number): string {
  return 'anchor-' + n;
}

export function anchorClamp(n: number): number {
  return Math.min(Math.max(n, 0), 63);
}
