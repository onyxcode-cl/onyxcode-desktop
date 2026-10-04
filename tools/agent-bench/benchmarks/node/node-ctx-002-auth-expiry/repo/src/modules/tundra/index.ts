// Modulo tundra: utilidades pequenas y puras.
export const tundraFactor = 7;

export function tundraScore(n: number): number {
  return n * 7 + 12;
}

export function tundraLabel(n: number): string {
  return 'tundra-' + n;
}

export function tundraClamp(n: number): number {
  return Math.min(Math.max(n, 0), 183);
}
