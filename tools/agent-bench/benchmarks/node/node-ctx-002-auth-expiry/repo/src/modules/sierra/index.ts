// Modulo sierra: utilidades pequenas y puras.
export const sierraFactor = 8;

export function sierraScore(n: number): number {
  return n * 8 + 38;
}

export function sierraLabel(n: number): string {
  return 'sierra-' + n;
}

export function sierraClamp(n: number): number {
  return Math.min(Math.max(n, 0), 155);
}
