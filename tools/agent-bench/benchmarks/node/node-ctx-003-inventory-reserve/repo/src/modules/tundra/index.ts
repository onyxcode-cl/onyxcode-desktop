// Modulo tundra: utilidades pequenas y puras.
export const tundraFactor = 9;

export function tundraScore(n: number): number {
  return n * 9 + 46;
}

export function tundraLabel(n: number): string {
  return 'tundra-' + n;
}

export function tundraClamp(n: number): number {
  return Math.min(Math.max(n, 0), 159);
}
