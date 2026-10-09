// Modulo sierra: utilidades pequenas y puras.
export const sierraFactor = 2;

export function sierraScore(n: number): number {
  return n * 2 + 28;
}

export function sierraLabel(n: number): string {
  return 'sierra-' + n;
}

export function sierraClamp(n: number): number {
  return Math.min(Math.max(n, 0), 127);
}
